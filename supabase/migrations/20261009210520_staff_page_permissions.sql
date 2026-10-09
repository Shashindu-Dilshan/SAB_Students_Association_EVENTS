-- Staff page grants live alongside the existing account record. Auth remains
-- the only password store; this table never receives password material.
alter table public.admins
  add column if not exists page_permissions text[] not null default array[]::text[],
  add column if not exists must_change_password boolean not null default false,
  add column if not exists is_active boolean not null default true;

alter table public.admins
  drop constraint if exists admins_page_permissions_valid;
alter table public.admins
  add constraint admins_page_permissions_valid check (
    page_permissions <@ array['dashboard', 'participants', 'tickets', 'event', 'scanner', 'settings']::text[]
  );

-- Keep access for staff accounts that existed before page-level grants.
update public.admins
set page_permissions = array['dashboard', 'participants', 'tickets', 'event', 'scanner', 'settings']::text[]
where role = 'STAFF' and cardinality(page_permissions) = 0;

create or replace function public.has_staff_page(required_page text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.admins as a
    where a.id = (select auth.uid())
      and a.is_active
      and (
        a.role = 'ADMIN'
        or (
          a.role = 'STAFF'
          and not a.must_change_password
          and a.page_permissions @> array[required_page]
        )
      )
  );
$$;
revoke all on function public.has_staff_page(text) from public, anon;
grant execute on function public.has_staff_page(text) to authenticated;

-- Replace the broad role-only admin policies with page-scoped rules.
do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('admins', 'events', 'participants', 'tickets', 'attendance')
  loop
    execute format('drop policy %I on %I.%I', policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  end loop;
end;
$$;

create policy "Admins can view own record"
  on public.admins for select to authenticated
  using (id = (select auth.uid()));

create policy "Public can view registration events"
  on public.events for select to anon
  using (registration_open = true or scanner_enabled = true);
create policy "Staff can view permitted events"
  on public.events for select to authenticated
  using (
    (select public.has_staff_page('dashboard')) or (select public.has_staff_page('event'))
    or (select public.has_staff_page('scanner')) or (select public.has_staff_page('settings'))
  );
create policy "Staff with event access can update events"
  on public.events for update to authenticated
  using ((select public.has_staff_page('event')))
  with check ((select public.has_staff_page('event')));

create policy "Staff can view permitted participants"
  on public.participants for select to authenticated
  using (
    (select public.has_staff_page('dashboard')) or (select public.has_staff_page('participants'))
    or (select public.has_staff_page('tickets')) or (select public.has_staff_page('scanner'))
  );
create policy "Staff with participant access can update participants"
  on public.participants for update to authenticated
  using ((select public.has_staff_page('participants')))
  with check ((select public.has_staff_page('participants')));
create policy "Staff with participant access can delete participants"
  on public.participants for delete to authenticated
  using ((select public.has_staff_page('participants')));

create policy "Staff can view permitted tickets"
  on public.tickets for select to authenticated
  using (
    (select public.has_staff_page('dashboard')) or (select public.has_staff_page('participants'))
    or (select public.has_staff_page('tickets')) or (select public.has_staff_page('scanner'))
  );
create policy "Staff with ticket or scanner access can update tickets"
  on public.tickets for update to authenticated
  using ((select public.has_staff_page('tickets')) or (select public.has_staff_page('scanner')))
  with check ((select public.has_staff_page('tickets')) or (select public.has_staff_page('scanner')));

create policy "Staff can view permitted attendance"
  on public.attendance for select to authenticated
  using ((select public.has_staff_page('dashboard')) or (select public.has_staff_page('scanner')));
create policy "Staff with scanner access can record attendance"
  on public.attendance for insert to authenticated
  with check ((select public.has_staff_page('scanner')));

