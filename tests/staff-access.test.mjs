import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const helperSource = await readFile(new URL("../assets/js/staff-access.js", import.meta.url), "utf8");

function harness(admin, hasSession = true) {
  const redirects = [];
  let signedOut = false;
  const client = {
    auth: {
      getSession: async () => ({ data: { session: hasSession ? { user: { id: "user-1", email: admin.email } } : null }, error: null }),
      signOut: async () => { signedOut = true; },
    },
    from: (table) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: table === "admins" ? admin : null, error: null }) }),
      }),
    }),
  };
  const window = { location: { replace: (path) => redirects.push(path) } };
  const document = { querySelectorAll: () => [] };
  vm.runInNewContext(helperSource, { window, document });
  return { window, client, redirects, get signedOut() { return signedOut; } };
}

test("an ADMIN can open every page", async () => {
  const h = harness({ id: "user-1", email: "admin@example.test", role: "ADMIN", is_active: true });
  for (const page of ["dashboard", "participants", "tickets", "event", "scanner", "settings"]) {
    assert.ok(await h.window.requireStaffPageAccess(h.client, page));
  }
  assert.deepEqual(h.redirects, []);
});

test("staff can open only an assigned page and are routed to an allowed page", async () => {
  const h = harness({ id: "user-1", email: "staff@example.test", role: "STAFF", is_active: true, must_change_password: false, page_permissions: ["scanner"] });
  assert.ok(await h.window.requireStaffPageAccess(h.client, "scanner"));
  assert.equal(await h.window.requireStaffPageAccess(h.client, "tickets"), null);
  assert.deepEqual(h.redirects, ["scanner.html"]);
});

test("first login is restricted to the password change page", async () => {
  const admin = { id: "user-1", email: "staff@example.test", role: "STAFF", is_active: true, must_change_password: true, page_permissions: ["participants"] };
  const h = harness(admin);
  assert.equal(await h.window.requireStaffPageAccess(h.client, "participants"), null);
  assert.deepEqual(h.redirects, ["force-password-change.html"]);
  const forcePage = harness(admin);
  assert.ok(await forcePage.window.requireStaffPageAccess(forcePage.client, "change-password"));
});

test("inactive and unauthenticated accounts cannot enter staff pages", async () => {
  const inactive = harness({ id: "user-1", role: "STAFF", is_active: false, page_permissions: ["dashboard"] });
  assert.equal(await inactive.window.requireStaffPageAccess(inactive.client, "dashboard"), null);
  assert.equal(inactive.signedOut, true);
  assert.deepEqual(inactive.redirects, ["admin.html"]);
  const anonymous = harness({}, false);
  assert.equal(await anonymous.window.requireStaffPageAccess(anonymous.client, "dashboard"), null);
  assert.deepEqual(anonymous.redirects, ["admin.html"]);
});

