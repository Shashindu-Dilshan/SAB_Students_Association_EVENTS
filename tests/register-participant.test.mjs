import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import {
  EMAIL_DUPLICATE_MESSAGE,
  REGISTRATION_DUPLICATE_MESSAGE,
  isEmailUniqueViolation,
  normalizeEmail,
} from "../supabase/functions/register-participant/registration-helpers.mjs";

const edgeSource = await readFile(
  new URL("../supabase/functions/register-participant/index.ts", import.meta.url),
  "utf8",
);

function createHarness() {
  const events = [
    { id: "event-1", event_code: "SAB26", event_name: "Event One", registration_open: true },
    { id: "event-2", event_code: "SAB27", event_name: "Event Two", registration_open: true },
  ];
  const participants = [];
  const tickets = [];
  let nextId = 1;
  const counts = { participantInserts: 0, ticketInserts: 0 };

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = {};
      this.action = "select";
    }

    select(fields) {
      this.fields = fields;
      return this;
    }

    eq(field, value) {
      this.filters[field] = value;
      if (this.action === "delete") {
        const collection = this.table === "participants" ? participants : tickets;
        const index = collection.findIndex((row) => row[field] === value);
        if (index >= 0) collection.splice(index, 1);
      }
      return this;
    }

    insert(values) {
      this.action = "insert";
      this.values = values;
      return this;
    }

    delete() {
      this.action = "delete";
      return this;
    }

    async maybeSingle() {
      const collection = this.table === "events" ? events : participants;
      const row = collection.find((candidate) =>
        Object.entries(this.filters).every(([field, value]) => {
          if (field === "email_normalized") {
            return normalizeEmail(candidate.email_normalized ?? candidate.email) === value;
          }
          return candidate[field] === value;
        })
      ) ?? null;
      return { data: row ? { id: row.id, ...row } : null, error: null };
    }

    async single() {
      if (this.table === "participants") {
        counts.participantInserts += 1;
        const normalized = normalizeEmail(this.values.email);
        const duplicateEmail = participants.some((row) =>
          row.event_id === this.values.event_id &&
          normalizeEmail(row.email_normalized ?? row.email) === normalized
        );
        if (duplicateEmail) {
          return {
            data: null,
            error: {
              code: "23505",
              constraint: "participants_event_id_email_normalized_uidx",
            },
          };
        }
        const duplicateRegistrationNo = participants.some((row) =>
          row.event_id === this.values.event_id &&
          row.registration_no === this.values.registration_no
        );
        if (duplicateRegistrationNo) {
          return {
            data: null,
            error: {
              code: "23505",
              constraint: "participants_event_id_registration_no_key",
            },
          };
        }

        const participant = {
          id: `participant-${nextId++}`,
          ...this.values,
          email_normalized: normalized,
        };
        participants.push(participant);
        return {
          data: {
            id: participant.id,
            full_name: participant.full_name,
            email: participant.email,
            registration_no: participant.registration_no,
          },
          error: null,
        };
      }

      if (this.table === "tickets") {
        counts.ticketInserts += 1;
        const ticket = { id: `ticket-${nextId++}`, ...this.values };
        tickets.push(ticket);
        return {
          data: {
            id: ticket.id,
            ticket_id: ticket.ticket_id,
            qr_data: ticket.qr_data,
            ticket_status: ticket.ticket_status,
            email_status: ticket.email_status,
          },
          error: null,
        };
      }
      throw new Error(`Unexpected insert into ${this.table}`);
    }
  }

  const source = edgeSource
    .replace(/^import\s+[\s\S]*?;\r?\n/gm, "")
    .replace("Deno.serve(async (req) => {", "globalThis.__registerHandler = async (req) => {")
    .replace(/\}\);\s*$/, "};\n");
  const stripped = stripTypeScriptTypes(source, { mode: "strip" });
  const context = {
    __helpers: {
      EMAIL_DUPLICATE_MESSAGE,
      REGISTRATION_DUPLICATE_MESSAGE,
      isEmailUniqueViolation,
      normalizeEmail,
    },
    Deno: { env: { get: () => "test-configured" } },
    createClient: () => ({ from: (table) => new Query(table) }),
    Response,
    crypto: webcrypto,
    console: { error() {} },
  };
  const helperSource = `const { EMAIL_DUPLICATE_MESSAGE, REGISTRATION_DUPLICATE_MESSAGE, isEmailUniqueViolation, normalizeEmail } = __helpers;\n`;
  vm.runInNewContext(helperSource + stripped, context, { filename: "register-participant.ts" });

  async function register({ email, event_code = "SAB26", registration_no = "U123" }) {
    const request = new Request("https://test.invalid/register-participant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_code,
        full_name: "Test Participant",
        email,
        registration_no,
        batch: "2026",
        gender: "Other",
        meal: "Veg",
      }),
    });
    const response = await context.__registerHandler(request);
    return { status: response.status, body: await response.json() };
  }

  return { participants, tickets, counts, register };
}

test("a new normalized email creates one participant and one ticket", async () => {
  const h = createHarness();
  const result = await h.register({ email: " New.User@Example.com " });

  assert.equal(result.status, 201);
  assert.equal(result.body.success, true);
  assert.equal(h.participants[0].email_normalized, "new.user@example.com");
  assert.equal(h.tickets.length, 1);
  assert.equal(h.tickets[0].qr_data, h.tickets[0].ticket_id);
});

test("the same email is rejected with the friendly duplicate message", async () => {
  const h = createHarness();
  await h.register({ email: "person@example.com" });
  const duplicate = await h.register({ email: "person@example.com", registration_no: "U124" });

  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error, EMAIL_DUPLICATE_MESSAGE);
  assert.equal(h.participants.length, 1);
  assert.equal(h.tickets.length, 1);
});

test("uppercase and lowercase email variants are duplicates", async () => {
  const h = createHarness();
  await h.register({ email: "person@example.com" });
  const duplicate = await h.register({ email: "PERSON@EXAMPLE.COM", registration_no: "U124" });

  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error, EMAIL_DUPLICATE_MESSAGE);
  assert.equal(h.participants.length, 1);
  assert.equal(h.tickets.length, 1);
});

test("leading and trailing email whitespace does not bypass duplicate prevention", async () => {
  const h = createHarness();
  await h.register({ email: "person@example.com" });
  const duplicate = await h.register({ email: "  person@example.com \t", registration_no: "U124" });

  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error, EMAIL_DUPLICATE_MESSAGE);
  assert.equal(h.participants.length, 1);
  assert.equal(h.tickets.length, 1);
});

test("the same email can register for another event", async () => {
  const h = createHarness();
  const first = await h.register({ email: "person@example.com", event_code: "SAB26" });
  const second = await h.register({ email: "person@example.com", event_code: "SAB27", registration_no: "U124" });

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(h.participants.length, 2);
  assert.equal(h.tickets.length, 2);
});

test("simultaneous requests create at most one participant and ticket", async () => {
  const h = createHarness();
  const results = await Promise.all([
    h.register({ email: "person@example.com", registration_no: "U123" }),
    h.register({ email: "PERSON@example.com", registration_no: "U124" }),
  ]);

  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  assert.equal(results.find((result) => result.status === 409).body.error, EMAIL_DUPLICATE_MESSAGE);
  assert.equal(h.participants.length, 1);
  assert.equal(h.tickets.length, 1);
  assert.equal(h.counts.ticketInserts, 1);
});

test("duplicate attempts do not insert additional tickets", async () => {
  const h = createHarness();
  await h.register({ email: "person@example.com" });
  const ticketCount = h.tickets.length;
  const result = await h.register({ email: "PERSON@example.com", registration_no: "U124" });

  assert.equal(result.status, 409);
  assert.equal(h.tickets.length, ticketCount);
  assert.equal(h.counts.ticketInserts, 1);
});

