// An Automation in one plain sentence: what starts it (with the field and value a record filter waits for), then what it does. Steps that only read, decide or wait are left out.
import test from "node:test";
import assert from "node:assert/strict";
import { cronWords, flowSentence } from "../flow-sentence.ts";

const names = {
  type: (k: string) => ({ customer: "Customer", deal: "Deal" })[k],
  field: (_t: string | undefined, k: string) => ({ stage: "Stage", owner: "Owner" })[k],
  value: (_t: string | undefined, f: string, v: unknown) => (f === "stage" && v === "signed" ? "Signed" : undefined),
  thing: (id: string) =>
    ({ usr_lena1234: "Lena Ortiz", frm_contact12: "Contact us", aut_other123: "Weekly report" })[id],
};

test("a record filter is said in words: the type, the field and the value it waits for, then what the steps do", () => {
  assert.equal(
    flowSentence(
      {
        triggers: [
          {
            key: "record_change",
            filter: { type: "customer", op: "updated", fields: ["stage"], where: { stage: "signed" } },
          },
        ],
        nodes: [
          { id: "p", key: "records.find", input: { type: "customer" }, next: ["e"] },
          { id: "e", key: "send_email", input: { to: "{{ trigger.record.email }}", draftOnly: true }, next: ["t"] },
          {
            id: "t",
            key: "create_task",
            input: { title: "Call them", assigned: { kind: "person", id: "usr_lena1234" } },
          },
        ],
      },
      names,
    ),
    "When a customer’s stage becomes Signed, draft an email and create a task for Lena Ortiz.",
  );
});

test("the title a person gave a step is what the sentence says, without its bracketed aside", () => {
  assert.equal(
    flowSentence({
      triggers: [{ key: "button" }],
      nodes: [{ id: "s", key: "sign", title: "Send the agreement for signature (customer, then us)", input: {} }],
    }),
    "When someone presses its button, send the agreement for signature.",
  );
});

test("each kind of start has its own words, and two starts are joined with or", () => {
  const one = (t: { key: string; config?: Record<string, unknown>; filter?: unknown }): string =>
    flowSentence({ triggers: [t], nodes: [{ id: "a", key: "post_message", input: {} }] }, names);
  assert.equal(
    one({ key: "record_change", filter: { type: "deal", op: "created" } }),
    "When a deal is added, post in chat.",
  );
  assert.equal(
    one({ key: "record_change", filter: { type: "deal", fields: ["owner", "stage"] } }),
    "When a deal’s owner or stage changes, post in chat.",
  );
  assert.equal(
    one({ key: "record_change", filter: { type: "invoice_line" } }),
    "When an invoice line is added or changes, post in chat.",
  );
  assert.equal(
    one({ key: "form_submit", filter: { formId: "frm_contact12" } }),
    "When the form Contact us is submitted, post in chat.",
  );
  assert.equal(one({ key: "schedule", config: { cron: "0 8 * * 1-5" } }), "Every weekday at 8 am, post in chat.");
  assert.equal(one({ key: "webhook" }), "When a web request arrives, post in chat.");
  assert.equal(
    flowSentence({
      triggers: [{ key: "manual" }, { key: "button" }],
      nodes: [{ id: "a", key: "post_message", input: {} }],
    }),
    "When someone runs it by hand or someone presses its button, post in chat.",
  );
});

test("more than three doing steps are counted, the same step twice is said once, and nothing to do says so", () => {
  const n = (id: string, key: string, title?: string) => ({ id, key, ...(title ? { title } : {}), input: {} });
  assert.equal(
    flowSentence({
      triggers: [{ key: "record_change", filter: { type: "deal", op: "created" } }],
      nodes: [
        n("a", "records.update"),
        n("b", "records.update"),
        n("c", "send_sms"),
        n("d", "create_task"),
        n("e", "sign"),
        n("f", "post_message"),
      ],
    }),
    "When a deal is added, update a record, send a text, and 3 more steps.",
  );
  assert.equal(
    flowSentence({ triggers: [{ key: "manual" }], nodes: [] }),
    "When someone runs it by hand, nothing happens yet.",
  );
  assert.equal(
    flowSentence({ triggers: [{ key: "manual" }], nodes: [n("a", "records.find"), n("b", "transform")] }),
    "When someone runs it by hand, it works through 2 steps.",
  );
});

test("no id and no template reaches the sentence", () => {
  const s = flowSentence({
    triggers: [{ key: "record_change", filter: { type: "deal", where: { owner: "usr_0a1b2c3d4e" } } }],
    nodes: [
      { id: "step_1", key: "send_email", title: "step_1", input: { to: "{{ trigger.record.email }}" } },
      { id: "c", key: "call_automation", input: { automationId: "aut_other123" } },
    ],
  });
  assert.equal(s, "When a deal’s owner becomes the one chosen, send an email and run another automation.");
  assert.doesNotMatch(s, /usr_|aut_|step_|\{\{/);
  assert.equal(
    flowSentence(
      {
        triggers: [{ key: "manual" }],
        nodes: [{ id: "c", key: "call_automation", input: { automationId: "aut_other123" } }],
      },
      names,
    ),
    "When someone runs it by hand, run Weekly report.",
  );
});

test("a cron is said in words when it has a common shape", () => {
  assert.equal(cronWords("0 9 * * *"), "Every day at 9 am");
  assert.equal(cronWords("30 14 * * 1"), "Every Monday at 2:30 pm");
  assert.equal(cronWords("0 * * * *"), "Every hour");
  assert.equal(cronWords("*/15 * * * *"), "Every 15 minutes");
  assert.equal(cronWords("0 7 1 * *"), "On day 1 of every month at 7 am");
  assert.equal(cronWords("5 4 * 2 *"), "On a schedule");
});

test("a step title is shortened in linear time, whatever hostile text it holds, and keeps its old reading", async () => {
  const { withoutTrailingParen, trimEndChars } = await import("../flow-sentence.ts");
  const t0 = Date.now();
  withoutTrailingParen("(".repeat(50_000) + "x");
  withoutTrailingParen(" ".repeat(50_000) + "(a");
  trimEndChars(".".repeat(50_000) + "x", ".:;");
  assert.ok(Date.now() - t0 < 100, `took ${Date.now() - t0} ms`);
  assert.equal(withoutTrailingParen("Email the client (draft)"), "Email the client");
  assert.equal(withoutTrailingParen("Email (a (b)"), "Email");
  assert.equal(withoutTrailingParen("Email the client"), "Email the client");
  assert.equal(withoutTrailingParen("(only)"), "");
  assert.equal(trimEndChars("Send it.:;", ".:;"), "Send it");
});
