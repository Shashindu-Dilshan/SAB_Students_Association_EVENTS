-- Use the email already held by the active Super Admin account as the single
-- source for the access-denied contact link. No address is duplicated in JS.
create or replace function public.get_admin_contact_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select a.email
  from public.admins as a
  where (select auth.uid()) is not null
    and a.role = 'ADMIN'
    and a.is_active
  order by a.created_at asc
  limit 1;
$$;

revoke all on function public.get_admin_contact_email() from public, anon;
grant execute on function public.get_admin_contact_email() to authenticated;
