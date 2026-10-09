# Staff management deployment

Staff accounts use Supabase Auth for email and password credentials. The `admins` table stores each staff member's role, selected page grants, active state, and whether the first-login password change is pending. The browser never writes passwords to SQL. The `staff-management` Edge Function uses `SUPABASE_SERVICE_ROLE_KEY` only on the server and permits staff-management actions only for an active `ADMIN`.

## Deploy

Use a current Supabase CLI in a trusted environment. The CLI was not available in this checkout, so the migration file was named using the repository's existing timestamp convention.

1. Review `supabase/migrations/20261009210520_staff_page_permissions.sql` and the function sources.
2. Link the project and apply the migration:

   ```sh
   supabase link --project-ref xdaxxgsvorvfpnxteikv
   supabase db push
   ```

3. In the Supabase Dashboard, open **Edge Functions → Secrets** and confirm `SUPABASE_SERVICE_ROLE_KEY` is set. If it is missing, add the key from the project’s API settings there. Never commit it, paste it into frontend code, or include it in command output or support logs.

4. Deploy the new function and redeploy the existing ticket functions with their new permission checks:

   ```sh
   supabase functions deploy staff-management --project-ref xdaxxgsvorvfpnxteikv
   supabase functions deploy send-ticket-email --project-ref xdaxxgsvorvfpnxteikv
   supabase functions deploy send-batch-tickets --project-ref xdaxxgsvorvfpnxteikv
   supabase functions deploy generate-ticket --project-ref xdaxxgsvorvfpnxteikv
   ```

   `verify_jwt` remains enabled. The `staff-management` function verifies the caller's JWT and reads the caller's role from the database before using its server-side Auth admin client.

5. Publish the website files through the repository's existing GitHub Pages deployment. The project URL and publishable key remain browser-visible as before; the service-role key must only exist in Edge Function secrets.

## Checks

Run the repository tests before deployment:

```sh
node tests/staff-access.test.mjs
node tests/staff-security.test.mjs
```

After deploying to a development project, verify with two accounts:

- Sign in as `ADMIN`; create staff with one selected page, then change or remove that grant and deactivate/reactivate the account.
- Sign in as the new staff member with the temporary password; confirm all protected routes send the account to the password-change screen and that protected table queries return no data before the change.
- Set a permanent password; sign in again and confirm only the selected page is reachable and visible in navigation.
- Call `staff-management` as staff and confirm list/create/update/deactivate actions return 403; call it without a valid user token and confirm the request is rejected.
- Try reading participants, tickets, attendance, and event rows directly with the staff session when their corresponding page grants are absent; RLS must reject those reads and writes. Confirm public registration still reads registration events as before.
- Confirm a staff account with no `participants` grant cannot invoke batch ticket email, and one with neither `participants` nor `tickets` cannot invoke single-ticket email.

Do not deploy the migration to production before confirming it against a development project and reviewing the existing `admins` rows. Existing `STAFF` records are backfilled with all six page grants to preserve their current access; newly created staff receive only the pages selected by the `ADMIN` who creates them.

## Rollback and containment

The migration adds columns and a permission function but replaces broad table policies. Do not roll it back by restoring the old role-only policies: that would give newly created staff accounts unrestricted access. If the release must be contained, deploy the previous website revision and keep the permission schema and restricted policies. As an immediate staff lockout, run `supabase/rollback/lockdown_staff_access.sql` in the SQL editor; it disables all STAFF accounts while leaving ADMIN access and data intact. Keep the staff rows and page grants so permissions can be restored deliberately after the issue is fixed.

