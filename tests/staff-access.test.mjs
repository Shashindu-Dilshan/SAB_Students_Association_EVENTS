import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const helperSource = await readFile(new URL("../assets/js/staff-access.js", import.meta.url), "utf8");

function harness(admin, hasSession = true) {
  const redirects = [];
  let signedOut = false;
  const fields = new Map();
  const panel = {
    hidden: true,
    addEventListener() {},
    querySelector: (selector) => {
      if (!fields.has(selector)) fields.set(selector, { hidden: false, textContent: "", setAttribute() {}, removeAttribute() {} });
      return fields.get(selector);
    },
  };
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
    rpc: async () => ({ data: "admin@example.test", error: null }),
  };
  const window = { location: { replace: (path) => redirects.push(path), assign: (path) => redirects.push(path) } };
  const document = {
    documentElement: { dataset: {}, classList: { add() {}, remove() {} } },
    head: { insertAdjacentHTML() {} },
    body: { insertAdjacentHTML() {} },
    getElementById: (id) => id === "staffAccessNotice" ? panel : null,
    addEventListener() {},
    querySelectorAll: () => [],
  };
  vm.runInNewContext(helperSource, { window, document });
  return { window, client, redirects, panel, fields, get signedOut() { return signedOut; } };
}

test("an ADMIN can open every page", async () => {
  const h = harness({ id: "user-1", email: "admin@example.test", role: "ADMIN", is_active: true });
  for (const page of ["dashboard", "participants", "tickets", "event", "scanner", "settings"]) {
    assert.ok(await h.window.requireStaffPageAccess(h.client, page));
  }
  assert.deepEqual(h.redirects, []);
});

test("staff can open assigned pages and see an access-denied notice for other pages", async () => {
  const h = harness({ id: "user-1", email: "staff@example.test", role: "STAFF", is_active: true, must_change_password: false, page_permissions: ["scanner"] });
  assert.ok(await h.window.requireStaffPageAccess(h.client, "scanner"));
  assert.equal(await h.window.requireStaffPageAccess(h.client, "participants"), null);
  assert.deepEqual(h.redirects, []);
  assert.equal(h.panel.hidden, false);
  assert.equal(h.fields.get("[data-admin-email]").textContent, "admin@example.test");
  assert.equal(h.fields.get("[data-access-action='dashboard']").hidden, true);
  const mailto = h.fields.get("[data-contact-admin]").href;
  assert.match(mailto, /^mailto:admin@example\.test\?/);
  assert.match(decodeURIComponent(mailto), /Request for Access – SABSA E-Ticket System/);
  assert.match(decodeURIComponent(mailto), /need permission to access a restricted page/);
});

test("dashboard action is offered only when the user has its permission", async () => {
  const h = harness({ id: "user-1", role: "STAFF", is_active: true, page_permissions: ["participants"] });
  await h.window.requireStaffPageAccess(h.client, "tickets");
  assert.equal(h.fields.get("[data-access-action='dashboard']").hidden, true);
  const dashboardStaff = harness({ id: "user-1", role: "STAFF", is_active: true, page_permissions: ["dashboard"] });
  await dashboardStaff.window.requireStaffPageAccess(dashboardStaff.client, "participants");
  assert.equal(dashboardStaff.fields.get("[data-access-action='dashboard']").hidden, false);
});

test("permission changes take effect on the next access check", async () => {
  const admin = { id: "user-1", role: "STAFF", is_active: true, page_permissions: ["scanner"] };
  const h = harness(admin);
  assert.equal(await h.window.requireStaffPageAccess(h.client, "participants"), null);
  admin.page_permissions = ["scanner", "participants"];
  assert.ok(await h.window.requireStaffPageAccess(h.client, "participants"));
  assert.equal(h.panel.hidden, true);
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

