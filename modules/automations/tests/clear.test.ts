// Automations that explain themselves (rc.41): the sentence on every list row, what is missing before anyone turns one on, how often one would have started last week, why one did not run for a
// record, and a test that starts from something real. Every answer comes from the definition and the event log through the code that starts Runs, so it is what the engine would do.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, create, engine, goodDefinition, node, NOW } from "../fixtures/seed.ts";
import { consumeEvent } from "../impl.ts";
import { explainMatch, matches } from "../handlers/triggers.ts";
import type { LoggedEvent } from "../handlers/triggers.ts";
import { findRunLink } from "../projections.ts";

const DAY = 86_400_000;
const TYPES = [
  {
    key: "customer",
    title: "Customer",
    plural: "Customers",
    titleField: "name",
    fields: [
      { key: "name", title: "Name", type: "text" },
      { key: "email", title: "Email", type: "email" },
      { key: "owner", title: "Owner", type: "text" },
      {
        key: "stage",
        title: "Stage",
        type: "status",
        options: {
          stages: [
            { key: "proposal", title: "Proposal" },
            { key: "signed", title: "Signed" },
          ],
        },
      },
    ],
  },
];
const RECORDS: Record<string, Record<string, unknown>> = {
  rec_bright: { name: "Brightpath", email: "hello@brightpath.example", stage: "signed" },
  rec_harbor: { name: "Harbor Co", email: "office@harborco.example", stage: "proposal" },
};
interface Row {
  seq: number;
  id: string;
  type: string;
  at: number;
  actor: string;
  depth: number;
  payload: Record<string, unknown>;
}
const changed = (
  seq: number,
  id: string,
  recordId: string,
  at: number,
  fields: Record<string, unknown>,
  type = "customer",
): Row => ({
  seq,
  id,
  type: "record.updated",
  at,
  actor: "usr_alice",
  depth: 0,
  payload: { recordId, type, fields, prev: {}, version: seq },
});
const LOG: Row[] = [
  changed(1, "evt_old", "rec_bright", NOW - 30 * DAY, { stage: "signed" }),
  changed(2, "evt_h1", "rec_harbor", NOW - 3 * DAY, { stage: "proposal" }),
  changed(3, "evt_b1", "rec_bright", NOW - 2 * DAY, { stage: "signed" }),
  changed(4, "evt_o1", "rec_order", NOW - 2 * DAY, { total: 12 }, "order"),
  changed(5, "evt_b2", "rec_bright", NOW - DAY, { owner: "Lena" }),
];

/** The parts of the product these reads ask: record types, records, and the event log read by position and by subject. */
function world(h: Harness, log: Row[] = LOG): void {
  h.callee("schema.describe", () => ({ types: TYPES }));
  h.callee("records.get", (i) => {
    const fields = RECORDS[i.recordId];
    if (!fields) throw Object.assign(new Error("no such record"), { error: { code: "validation.not_found" } });
    return { record: { id: i.recordId, type: i.type, version: 1, label: 0, fields, holds: 0 } };
  });
  h.callee("events.since", (i) => {
    const rows = log.filter((e) => e.seq > i.after && (!i.types || i.types.includes(e.type))).slice(0, i.limit ?? 100);
    return {
      events: rows,
      next: rows.length ? rows[rows.length - 1]!.seq : i.after,
      head: log[log.length - 1]?.seq ?? 0,
    };
  });
  h.callee("events.list", (i) => ({
    events: log.filter((e) => !i.subject || e.payload["recordId"] === i.subject.id).slice(0, i.limit ?? 100),
  }));
  h.callee("events.get", (i) => {
    const event = log.find((e) => e.id === i.eventId);
    if (!event) throw Object.assign(new Error("no such event"), { error: { code: "validation.not_found" } });
    return { event };
  });
}
const SIGNED = {
  key: "record_change",
  filter: { type: "customer", op: "updated", fields: ["stage"], where: { stage: "signed" } },
};
const welcome = (over: Record<string, unknown> = {}) =>
  create({
    name: "Welcome new customers",
    definition: goodDefinition({
      triggers: [SIGNED],
      nodes: [
        node(
          "mail",
          "send_email",
          {
            to: "{{ trigger.record.email }}",
            subject: "Welcome",
            body: "Hello",
            draftOnly: true,
            mailboxId: "mbx_space",
          },
          { next: ["task"] },
        ),
        node("task", "create_task", { title: "Kick-off call", assigned: { kind: "person", id: "usr_alice" } }),
      ],
    }),
    ...over,
  });
const made = async (h: Harness, input: Record<string, unknown>): Promise<string> =>
  (await h.call("automations.create", input, alice)).automation.id as string;

test("every list row says what the Automation does in one sentence, with the Space's own names", async () => {
  const h = harness();
  world(h);
  await made(h, welcome());
  const rows = (await h.call("automations.list", {}, alice)).automations as { name: string; sentence?: string }[];
  assert.equal(rows[0]!.sentence, "When a customer’s stage becomes Signed, draft an email and create a task.");
  assert.doesNotMatch(rows[0]!.sentence!, /_|\{\{/);
});

test("the sentence is still written when the record types cannot be read: keys are said as words", async () => {
  const h = harness();
  await made(h, welcome());
  const rows = (await h.call("automations.list", {}, alice)).automations as { sentence?: string }[];
  assert.equal(rows[0]!.sentence, "When a customer’s stage becomes Signed, draft an email and create a task.");
});

test("what a trigger looked at is told check by check, and it is the same answer the engine starts Runs by", () => {
  const ev = (fields: Record<string, unknown>, type = "customer"): LoggedEvent => ({
    id: "evt_x",
    type: "record.updated",
    payload: { recordId: "rec_1", type, fields, prev: {} },
  });
  const yes = explainMatch(SIGNED, ev({ stage: "signed" }));
  assert.equal(yes.ok, true);
  assert.deepEqual(
    yes.checks.map((c) => [c.key, c.ok]),
    [
      ["type", true],
      ["op", true],
      ["fields", true],
      ["where", true],
    ],
  );
  const no = explainMatch(SIGNED, ev({ stage: "proposal" }));
  assert.equal(no.ok, false);
  assert.deepEqual(no.checks[no.checks.length - 1], {
    ok: false,
    key: "where",
    field: "stage",
    want: "signed",
    got: "proposal",
  });
  const other = explainMatch(SIGNED, ev({ owner: "Lena" }));
  assert.deepEqual(other.checks[other.checks.length - 1], {
    ok: false,
    key: "fields",
    want: ["stage"],
    got: ["owner"],
  });
  for (const e of [
    ev({ stage: "signed" }),
    ev({ stage: "proposal" }),
    ev({ owner: "Lena" }),
    ev({ stage: "signed" }, "order"),
  ])
    assert.equal(matches(SIGNED, e), explainMatch(SIGNED, e).ok, "one answer for the consumer and for the page");
  assert.equal(matches({ key: "record_change", filter: "nonsense" }, ev({})), "filter_error");
  assert.equal(explainMatch({ key: "schedule" }, ev({})).listens, false);
});

test("last week: how many things of its kind happened and how many would have started it, each named, with why the others did not", async () => {
  const h = harness();
  world(h);
  const id = await made(h, welcome());
  const out = await h.call("automations.would_run", { automationId: id }, alice);
  assert.equal(out.supported, true);
  assert.equal(
    out.of,
    3,
    "three changes to customers in the last week; the order and the month-old change are not counted",
  );
  assert.equal(out.n, 1);
  assert.equal(out.what, "changes to Customers");
  assert.deepEqual(
    out.starts.map((s: { name: string; starts: boolean; change: string; why?: string }) => [
      s.name,
      s.starts,
      s.change,
      s.why ?? null,
    ]),
    [
      ["Brightpath", false, "Owner became Lena", "This change was to Owner."],
      ["Brightpath", true, "Stage became Signed", null],
      ["Harbor Co", false, "Stage became Proposal", "It became Proposal."],
    ],
  );
  assert.equal(h.runs.length, 0, "nothing ran");
});

test("last week has no answer for a trigger no event starts", async () => {
  const h = harness();
  world(h);
  const id = await made(h, create({ definition: goodDefinition({ triggers: [{ key: "manual" }] }) }));
  const out = await h.call("automations.would_run", { automationId: id }, alice);
  assert.deepEqual([out.supported, out.n, out.of], [false, 0, 0]);
});

test("why it did not run: the Automation that watches this kind of record says which check stopped it, in words", async () => {
  const h = harness();
  world(h);
  const id = await made(h, welcome());
  await h.call("automations.set_enabled", { automationId: id, enabled: true }, alice).catch(() => undefined);
  const out = await h.call("automations.why_not", { type: "customer", recordId: "rec_harbor" }, alice);
  assert.deepEqual(out.record, {
    id: "rec_harbor",
    type: "customer",
    typeName: "Customer",
    typePlural: "Customers",
    title: "Harbor Co",
  });
  assert.equal(out.changes[0].line, "Stage became Proposal");
  const a = out.automations[0];
  assert.equal(a.name, "Welcome new customers");
  assert.equal(a.verdict, "not_started");
  assert.equal(a.line, "Did not start");
  assert.deepEqual(a.checks, [
    { ok: true, line: "A customer changed" },
    { ok: true, line: "It was changed" },
    { ok: true, line: "Stage changed" },
    { ok: false, line: "Stage becomes Signed", detail: "It became Proposal." },
  ]);
  for (const c of a.checks)
    assert.doesNotMatch(
      `${c.line} ${c.detail ?? ""}`,
      /[a-z]{3}_[a-z0-9]{4,}|\{\{/,
      "no id and no template in a line a person reads",
    );
});

test("why it did not run: a Run that started and failed says where, one that is off says so, and an Automation for another type is not listed", async () => {
  const h = harness();
  world(h);
  h.callee("comms.senders.list", () => ({
    senders: [{ id: "mbx_space", channel: "email", address: "hello@northwind.example", usable: true }],
  }));
  const on = await made(h, welcome());
  await h.call("automations.set_enabled", { automationId: on, enabled: true }, alice);
  await made(h, welcome({ name: "Stage report" }));
  await made(
    h,
    create({
      name: "Order follow-up",
      definition: goodDefinition({ triggers: [{ key: "record_change", filter: { type: "order" } }] }),
    }),
  );
  // the change that matches really starts a Run of the one that is on, and that Run fails at its second step
  const ev = LOG[2]!;
  const fired = await h.consumer(engine, (ctx) => consumeEvent(ctx, { id: ev.id, type: ev.type, payload: ev.payload }));
  const runId = (fired[0]!.result as { runId: string }).runId;
  assert.equal(findRunLink(h.db as never, runId)?.eventId, "evt_b1");
  h.callee("runs.get", () => ({ run: { id: runId, status: "failed" } }));
  h.callee("runs.steps", () => ({
    steps: [
      { step: "mail", attempt: 1, state: "succeeded" },
      {
        step: "task",
        attempt: 1,
        state: "failed",
        error: { code: "validation.bad_input", message: "Create a task: choose who it is for." },
      },
    ],
  }));
  const out = await h.call(
    "automations.why_not",
    { type: "customer", recordId: "rec_bright", eventId: "evt_b1" },
    alice,
  );
  assert.deepEqual(
    out.automations.map((a: { name: string; verdict: string; line: string }) => [a.name, a.verdict, a.line]),
    [
      ["Welcome new customers", "failed", "Failed at step 2"],
      ["Stage report", "off", "Off"],
    ],
  );
  const failed = out.automations[0];
  assert.equal(failed.runId, runId);
  assert.deepEqual(failed.checks.slice(-2), [
    { ok: true, line: "It started a run" },
    { ok: false, line: "Step 2, create a task", detail: "Create a task: choose who it is for." },
  ]);
  assert.equal(out.automations[1].checks.at(-1).detail, "It has never been turned on.");
});

test("what is missing shows before anyone turns it on: a draft with no mailbox, an app that is not connected, a file that is gone", async () => {
  const h = harness();
  world(h);
  h.callee("comms.senders.list", () => ({ senders: [] }));
  h.callee("connections.list", () => ({ connections: [] }));
  h.callee("github.me.status", () => ({ connected: false }));
  h.callee("github.installations.list", () => ({ installations: [] }));
  h.callee("files.get", (i) => {
    if (i.fileId === "fil_gone") throw Object.assign(new Error("gone"), { error: { code: "validation.not_found" } });
    return { file: { id: i.fileId } };
  });
  const mail = await made(h, welcome());
  const sheet = await made(
    h,
    create({
      name: "Sheet",
      definition: goodDefinition({
        nodes: [node("g", "google.sheets.append_values", { spreadsheetId: "abc", range: "A1", values: [["x"]] })],
      }),
    }),
  );
  const sign = await made(
    h,
    create({
      name: "Agreement",
      definition: goodDefinition({
        nodes: [
          node("s", "sign", {
            fileId: "fil_gone",
            signers: [{ name: "Andrea Lindahl", email: "andrea@northwind.example" }],
          }),
        ],
      }),
    }),
  );
  const fine = await made(h, create({ name: "Fine" }));
  const out = await h.call("automations.readiness", {}, alice);
  const by = new Map(
    (out.blocked as { automationId: string; short: string; button: string; fix: { kind: string }; line: string }[]).map(
      (b) => [b.automationId, b],
    ),
  );
  assert.deepEqual(
    [by.get(mail)!.short, by.get(mail)!.button, by.get(mail)!.fix.kind],
    ["No mailbox", "Connect", "mailbox"],
  );
  assert.match(by.get(mail)!.line, /^Step 1, send an email: no mailbox is connected/);
  assert.deepEqual(
    [by.get(sheet)!.short, by.get(sheet)!.button, by.get(sheet)!.fix],
    ["Google is not connected", "Connect", { kind: "connection", connector: "google" }],
  );
  assert.deepEqual(
    [by.get(sign)!.short, by.get(sign)!.button, by.get(sign)!.fix.kind],
    ["A file is missing", "Fix", "file"],
  );
  assert.equal(by.has(fine), false);
  assert.equal(h.runs.length, 0, "nothing was turned on or run to find out");
});

test("one Automation, or the draft on its page, gets its sentence and what it is missing in one read", async () => {
  const h = harness();
  world(h);
  h.callee("comms.senders.list", () => ({ senders: [] }));
  const id = await made(h, welcome());
  const out = await h.call("automations.readiness", { automationId: id }, alice);
  assert.equal(out.sentence, "When a customer’s stage becomes Signed, draft an email and create a task.");
  assert.deepEqual(
    [out.blocked[0].short, out.blocked[0].nodeId, out.blocked[0].automationId],
    ["No mailbox", "mail", id],
  );
});

test("a test can start from something real: a row of the event log, or a record as its newest change left it", async () => {
  const h = harness();
  world(h);
  const id = await made(h, welcome());
  const byEvent = await h.call("automations.test", { automationId: id, eventId: "evt_h1" }, alice);
  const p1 = findRunLink(h.db as never, byEvent.runId)!;
  assert.equal(p1.test, true);
  assert.equal(p1.trigger, "record_change");
  assert.deepEqual((p1.payload as { changed: unknown; recordId: string }).changed, { stage: "proposal" });
  assert.equal((p1.payload as { recordId: string }).recordId, "rec_harbor");
  const byRecord = await h.call(
    "automations.test",
    { automationId: id, recordId: "rec_bright", recordType: "customer" },
    alice,
  );
  const p2 = findRunLink(h.db as never, byRecord.runId)!.payload as { changed: unknown; recordId: string };
  assert.deepEqual(p2.changed, { owner: "Lena" }, "the newest thing that happened to it");
  const gone = await h.call("automations.test", { automationId: id, eventId: "evt_nothere" }, alice).then(
    () => null,
    (e: { error?: { message?: string } }) => e.error?.message,
  );
  assert.equal(gone, "That is not there any more. Pick another.");
});
