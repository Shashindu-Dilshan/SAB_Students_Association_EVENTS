-- Emergency containment after the staff-permission migration is applied.
-- Keeps the ADMIN account and all records intact, while denying staff access.
-- Do not drop the permission columns/function or restore the old broad policies.
update public.admins
set is_active = false
where role = 'STAFF';

-- Expected to return zero active staff rows.
select count(*) as active_staff_accounts
from public.admins
where role = 'STAFF' and is_active;

