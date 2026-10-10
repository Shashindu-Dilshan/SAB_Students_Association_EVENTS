-- QR visibility is opt-in. If the setting is missing or unavailable,
-- the public registration page keeps QR display disabled.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS show_qr_after_registration boolean NOT NULL DEFAULT false;

-- Keep every existing participant and ticket. For legacy duplicate emails,
-- assign the normalized value only to the earliest participant in each
-- event/email group; the remaining legacy rows stay intact with NULL here.
-- The indexed row still blocks any new registration for that email/event.
ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS email_normalized text;

WITH normalized_participants AS (
  SELECT
    id,
    event_id,
    lower(
      nullif(
        regexp_replace(
          coalesce(email, ''),
          '^[[:space:]]+|[[:space:]]+$',
          '',
          'g'
        ),
        ''
      )
    ) AS normalized_email,
    created_at
  FROM public.participants
),
ranked_participants AS (
  SELECT
    id,
    normalized_email,
    row_number() OVER (
      PARTITION BY event_id, normalized_email
      ORDER BY created_at ASC, id ASC
    ) AS duplicate_rank
  FROM normalized_participants
)
UPDATE public.participants AS participant
SET email_normalized = ranked.normalized_email
FROM ranked_participants AS ranked
WHERE participant.id = ranked.id
  AND ranked.duplicate_rank = 1
  AND ranked.normalized_email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS participants_event_id_email_normalized_uidx
  ON public.participants (event_id, email_normalized)
  WHERE email_normalized IS NOT NULL;

COMMENT ON COLUMN public.participants.email_normalized IS
  'Lowercase, trimmed email used for per-event registration uniqueness. NULL is retained for extra legacy duplicate rows.';

CREATE OR REPLACE FUNCTION public.set_participant_email_normalized()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.event_id IS DISTINCT FROM OLD.event_id
     OR NEW.email IS DISTINCT FROM OLD.email THEN
    NEW.email_normalized := lower(
      nullif(
        regexp_replace(
          coalesce(NEW.email, ''),
          '^[[:space:]]+|[[:space:]]+$',
          '',
          'g'
        ),
        ''
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_participant_email_normalized() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_participant_email_normalized() TO authenticated, service_role;

DROP TRIGGER IF EXISTS set_participant_email_normalized
  ON public.participants;

CREATE TRIGGER set_participant_email_normalized
  BEFORE INSERT OR UPDATE OF event_id, email
  ON public.participants
  FOR EACH ROW
  EXECUTE FUNCTION public.set_participant_email_normalized();
