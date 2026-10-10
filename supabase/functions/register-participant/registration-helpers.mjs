export const EMAIL_DUPLICATE_MESSAGE =
  "This email address is already registered for this event. Please use your existing ticket or contact the event administration if you need assistance.";

export const REGISTRATION_DUPLICATE_MESSAGE =
  "This student is already registered for this event.";

export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function isEmailUniqueViolation(error) {
  if (error?.code !== "23505") return false;

  const uniqueIndexName = "participants_event_id_email_normalized_uidx";
  return [error.constraint, error.message, error.details].some(
    (value) => typeof value === "string" && value.includes(uniqueIndexName),
  );
}
