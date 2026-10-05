create policy "Admins can update participants"
on public.participants
for update
to authenticated
using (
  exists (
    select 1
    from public.admins
    where admins.id = (select auth.uid())
      and admins.role = any (array['ADMIN'::text, 'STAFF'::text])
  )
)
with check (
  exists (
    select 1
    from public.admins
    where admins.id = (select auth.uid())
      and admins.role = any (array['ADMIN'::text, 'STAFF'::text])
  )
);

create policy "Admins can delete participants"
on public.participants
for delete
to authenticated
using (
  exists (
    select 1
    from public.admins
    where admins.id = (select auth.uid())
      and admins.role = any (array['ADMIN'::text, 'STAFF'::text])
  )
);