import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("all protected HTML pages load the shared access guard", async () => {
  const files = ["admin-dashboard.html", "participants.html", "tickets.html", "event.html", "scanner.html", "settings.html"];
  for (const file of files) {
    const html = await read(file);
    assert.match(html, /assets\/js\/staff-access\.js/, `${file} must load the route guard`);
  }
});

test("inline JavaScript parses in every admin page", async () => {
  const files = ["admin.html", "admin-dashboard.html", "participants.html", "tickets.html", "event.html", "scanner.html", "settings.html", "force-password-change.html"];
  for (const file of files) {
    const html = await read(file);
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    for (const [, attributes, source] of scripts) {
      if (/\bsrc\s*=/.test(attributes) || !source.trim()) continue;
      assert.doesNotThrow(() => new vm.Script(source, { filename: file }), `${file} contains invalid inline JavaScript`);
    }
  }
});

test("the migration scopes data policies by stored page permission", async () => {
  const sql = await read("supabase/migrations/20261009210520_staff_page_permissions.sql");
  for (const page of ["dashboard", "participants", "tickets", "event", "scanner", "settings"]) {
    assert.ok(sql.includes(`has_staff_page('${page}')`), `missing policy mapping for ${page}`);
  }
  assert.match(sql, /must_change_password/);
  assert.match(sql, /is_active/);
  assert.match(sql, /security invoker/i);
});

test("admin contact email comes from the active admin record and is authenticated-only", async () => {
  const sql = await read("supabase/migrations/20261010120000_admin_contact_email.sql");
  assert.match(sql, /security definer/i);
  assert.match(sql, /a\.role = 'ADMIN'/);
  assert.match(sql, /a\.is_active/);
  assert.match(sql, /a\.email/);
  assert.match(sql, /revoke all[\s\S]*from public, anon/i);
  assert.match(sql, /grant execute[\s\S]*to authenticated/i);
  const guard = await read("assets/js/staff-access.js");
  assert.match(guard, /rpc\("get_admin_contact_email"\)/);
  assert.match(guard, /mailto:/);
});

test("staff management keeps credentials in Supabase Auth and checks ADMIN in the server", async () => {
  const edge = await read("supabase/functions/staff-management/index.ts");
  assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(edge, /auth\.getUser\(token\)/);
  assert.match(edge, /actor\.role !== "ADMIN"/);
  assert.match(edge, /auth\.admin\.createUser\(\{[\s\S]*?password,[\s\S]*?email_confirm: true/);
  assert.match(edge, /must_change_password: true/);
  assert.match(edge, /auth\.admin\.updateUserById\(userId, \{ password \}\)/);
  assert.match(edge, /temporary password between 6 and 128 characters/);
  assert.match(edge, /password\.length < 12[\s\S]*?password between 12 and 128 characters/);
  assert.doesNotMatch(edge, /encrypted_password|password_hash\s*:/);
});

test("the staff creation form accepts six-character temporary passwords", async () => {
  const settings = await read("settings.html");
  assert.match(settings, /id="staffTemporaryPassword"[^>]*minlength="6"/);
  assert.match(settings, /At least 6 characters\. Share it securely/);
});

test("ticket email functions enforce page permission and forced-password state", async () => {
  const email = await read("supabase/functions/send-ticket-email/index.ts");
  const batch = await read("supabase/functions/send-batch-tickets/index.ts");
  const ticket = await read("supabase/functions/generate-ticket/index.ts");
  assert.match(email, /admin\.must_change_password/);
  assert.match(email, /page === "tickets" \|\| page === "participants"/);
  assert.match(batch, /admin\.must_change_password/);
  assert.match(batch, /page_permissions\?\.includes\("participants"\)/);
  assert.match(ticket, /auth\.getUser\(token\)/);
  assert.match(ticket, /page_permissions/);
  assert.match(ticket, /must_change_password/);
});

