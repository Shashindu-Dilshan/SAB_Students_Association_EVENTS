import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import {
  EMAIL_DUPLICATE_MESSAGE,
  isEmailUniqueViolation,
  normalizeEmail,
} from "../supabase/functions/register-participant/registration-helpers.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const publicSource = await read("assets/js/public.js");

function createRegistrationHarness({
  qrSetting = { data: { show_qr_after_registration: false }, error: null },
  invokeResult = {
    data: {
      success: true,
      participant: { name: "Ada" },
      ticket: { ticket_id: "SAB26-ABC123" },
    },
    error: null,
  },
} = {}) {
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        hidden: true,
        disabled: false,
        textContent: "",
        className: "",
        value: "",
        listeners: {},
        addEventListener(type, listener) { this.listeners[type] = listener; },
        setAttribute() {},
        focus() {},
      });
    }
    return elements.get(id);
  };

  const form = getElement("registration-form");
  form.querySelectorAll = () => [];
  form.reportValidity = () => true;
  form.addEventListener = (type, listener) => { form.submitHandler = listener; };
  const qrWrap = getElement("qr-wrap");
  const canvas = getElement("ticket-qr");
  canvas.parentElement = qrWrap;
  canvas.toDataURL = () => "data:image/png;base64,QR";
  getElement("registration-loading").hidden = false;

  const registrationEvent = {
    id: "event-1",
    event_name: "SAB Annual Event",
    event_code: "SAB26",
    event_date: "2026-10-10",
    event_time: "10:00 AM",
    venue: "Colombo",
    registration_open: true,
  };
  let submitPayload = null;
  let qrCalls = 0;
  let qrSettingsRequested = false;
  let readyCallback = null;

  const client = {
    from(table) {
      return {
        select(fields) {
          const query = {
            eq() { return query; },
            order() { return query; },
            limit() { return query; },
            async maybeSingle() {
              if (table === "events" && fields === "show_qr_after_registration") {
                qrSettingsRequested = true;
                return qrSetting;
              }
              return { data: registrationEvent, error: null };
            },
          };
          return query;
        },
      };
    },
    functions: {
      async invoke(name, options) {
        assert.equal(name, "register-participant");
        submitPayload = options.body;
        return invokeResult;
      },
    },
  };

  class FakeFormData {
    get(name) {
      return {
        full_name: " Ada Participant ",
        email: "  PERSON@Example.COM  ",
        phone: "",
        registration_no: " U123 ",
        batch: " 2026 ",
        gender: " Other ",
        meal: " Veg ",
      }[name] ?? "";
    }
  }

  const document = {
    body: { dataset: { page: "registration" } },
    addEventListener(type, listener) {
      if (type === "DOMContentLoaded") readyCallback = listener;
    },
    getElementById: getElement,
    createElement() {
      return { click() {}, href: "", download: "" };
    },
  };
  const window = {
    location: { search: "?event_code=SAB26" },
    supabase: { createClient: () => client },
    QRCode: {
      async toCanvas() { qrCalls += 1; },
    },
  };
  const context = {
    window,
    document,
    FormData: FakeFormData,
    URLSearchParams,
    Date,
    Intl,
    console: { error() {} },
  };

  vm.runInNewContext(publicSource, context, { filename: "public.js" });
  getElement("registration-success");
  getElement("form-message");
  readyCallback();

  return {
    elements,
    form,
    canvas,
    qrWrap,
    get qrCalls() { return qrCalls; },
    get qrSettingsRequested() { return qrSettingsRequested; },
    get submitPayload() { return submitPayload; },
    async ready() {
      await new Promise((resolve) => setImmediate(resolve));
    },
    async submit() {
      await form.submitHandler({ currentTarget: form, preventDefault() {} });
    },
  };
}

test("email normalization trims whitespace and lowercases the address", () => {
  assert.equal(normalizeEmail("  PERSON@Example.COM\t"), "person@example.com");
  assert.equal(normalizeEmail(null), "");
});

test("the backend recognizes only the email unique-index violation", () => {
  assert.equal(
    isEmailUniqueViolation({
      code: "23505",
      message: 'duplicate key violates "participants_event_id_email_normalized_uidx"',
    }),
    true,
  );
  assert.equal(
    isEmailUniqueViolation({
      code: "23505",
      message: 'duplicate key violates "participants_event_id_registration_no_key"',
    }),
    false,
  );
  assert.equal(isEmailUniqueViolation({ code: "23503" }), false);
});

test("QR display is hidden when disabled and registration still succeeds", async () => {
  const h = createRegistrationHarness({
    qrSetting: { data: { show_qr_after_registration: false }, error: null },
  });
  await h.ready();
  assert.equal(h.qrSettingsRequested, true);
  await h.submit();

  assert.equal(h.elements.get("registration-success").hidden, false);
  assert.equal(h.elements.get("success-ticket-id").textContent, "SAB26-ABC123");
  assert.equal(h.qrWrap.hidden, true);
  assert.equal(h.canvas.hidden, true);
  assert.equal(h.elements.get("download-qr").hidden, true);
  assert.equal(h.elements.get("qr-not-displayed").hidden, false);
  assert.equal(h.elements.get("qr-error").hidden, true);
  assert.equal(h.elements.get("success-ticket-note").textContent.includes("QR code"), false);
  assert.equal(h.qrCalls, 0);
  assert.equal(h.submitPayload.email, "person@example.com");
});

test("QR display and download are available only when Supabase returns true", async () => {
  const h = createRegistrationHarness({
    qrSetting: { data: { show_qr_after_registration: true }, error: null },
  });
  await h.ready();
  await h.submit();

  assert.equal(h.elements.get("registration-success").hidden, false);
  assert.equal(h.qrWrap.hidden, false);
  assert.equal(h.canvas.hidden, false);
  assert.equal(h.elements.get("download-qr").hidden, false);
  assert.equal(h.elements.get("qr-not-displayed").hidden, true);
  assert.equal(h.elements.get("success-ticket-note").textContent.includes("QR code"), true);
  assert.equal(h.qrCalls, 1);
});

test("a failed QR-setting lookup keeps registration working and hides the QR", async () => {
  const h = createRegistrationHarness({
    qrSetting: { data: null, error: new Error("setting unavailable") },
  });
  await h.ready();
  await h.submit();

  assert.equal(h.elements.get("registration-success").hidden, false);
  assert.equal(h.elements.get("success-ticket-id").textContent, "SAB26-ABC123");
  assert.equal(h.qrWrap.hidden, true);
  assert.equal(h.elements.get("download-qr").hidden, true);
  assert.equal(h.elements.get("qr-not-displayed").hidden, false);
  assert.equal(h.elements.get("qr-error").hidden, true);
  assert.equal(h.elements.get("success-ticket-note").textContent.includes("QR code"), false);
  assert.equal(h.qrCalls, 0);
});

test("the duplicate-email response is shown to participants", async () => {
  const h = createRegistrationHarness({
    invokeResult: {
      data: null,
      error: {
        context: {
          status: 409,
          clone: () => ({ json: async () => ({ error: EMAIL_DUPLICATE_MESSAGE }) }),
        },
      },
    },
  });
  await h.ready();
  await h.submit();

  assert.equal(h.elements.get("form-message").textContent, EMAIL_DUPLICATE_MESSAGE);
  assert.equal(h.elements.get("registration-success").hidden, true);
});

test("database migration preserves legacy rows and adds per-event atomic uniqueness", async () => {
  const sql = await read("supabase/migrations/20261010130000_qr_visibility_and_email_uniqueness.sql");
  const edge = await read("supabase/functions/register-participant/index.ts");

  assert.match(sql, /show_qr_after_registration boolean NOT NULL DEFAULT false/i);
  assert.match(sql, /row_number\(\) OVER/i);
  assert.match(sql, /participants_event_id_email_normalized_uidx[\s\S]*?\(event_id, email_normalized\)[\s\S]*?WHERE email_normalized IS NOT NULL/i);
  assert.match(sql, /BEFORE INSERT OR UPDATE OF event_id, email/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+public\.participants/i);
  assert.match(edge, /\.eq\("email_normalized", email\)/);
  assert.match(edge, /isEmailUniqueViolation\(participantError\)/);
  assert.ok(
    edge.indexOf("email_normalized", edge.indexOf("Check email first")) <
      edge.indexOf("registration_no", edge.indexOf("Check email first")),
    "email duplicates are checked before the existing registration-number rule",
  );
});

test("event controls expose, load, and save the QR setting", async () => {
  const html = await read("event.html");
  assert.match(html, /id="showQrAfterRegistration"/);
  assert.match(html, /Show QR Code After Registration/);
  assert.match(html, /Allow participants to view and download their QR code on the registration success page\./);
  assert.match(html, /event\.show_qr_after_registration === true/);
  assert.match(html, /show_qr_after_registration:\s*showQrAfterRegistration/);
});
