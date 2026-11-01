// chat.flow_card: a drafted Flow leaves a card with its words and two buttons that call something; only a draft gets one, and the buttons name that one draft.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DANA, INTAKE, codeOf, harness } from "../fixtures/harness.ts";

type Fn = (ctx: any, input: any) => Promise<any>;
const h = handlers as unknown as Record<string, Fn>;
let n = 0;
const key = (): string => `fc-${++n}`;

const DEF = { triggers: [{ key: "record_change" }], nodes: [{ id: "a", key: "create_task", title: "Make a task to call the lead", next: ["b"] }, { id: "b", key: "send_email", title: "Email me the summary" }] };
const world = (status = "draft") => harness({ calls: { "agents.get": () => ({ agent: {} }), "automations.get": (i) => ({ automation: { id: i.automationId, name: "New lead task", status, definition: DEF } }) } });

test("the card says what the Flow does and carries Turn on and Test, as a system line the server wrote", async () => {
  const hn = world();
  const thread = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread.threadId as string;
  const out = await h["chat.flow_card"]!(hn.agent(INTAKE, DANA), { threadId: thread, automationId: "aut_abc123", idempotencyKey: key() });
  const row = hn.rows(`SELECT body, blocks, kind FROM chat_message WHERE id = ?`, out.messageId)[0]!;
  assert.equal(row["kind"], "system");
  const block = JSON.parse(String(row["blocks"]))[0];
  assert.equal(block.type, "link_card");
  assert.equal(block.data.lead, "Flow drafted");
  assert.deepEqual(block.data.body.split("\n"), ["When a record changes", "Then make a task to call the lead", "Then email me the summary, held for your yes"]);
  assert.deepEqual(block.data.target, { type: "automation", id: "aut_abc123" });
  assert.deepEqual(block.data.actions, [
    { key: "on", label: "Turn on", cap: "automations.set_enabled", input: { automationId: "aut_abc123", enabled: true } },
    { key: "test", label: "Test", cap: "automations.test", input: { automationId: "aut_abc123" } },
  ]);
});

test("a Flow that is already running gets no card, and the card's words are not the caller's to choose", async () => {
  const hn = world("on");
  const thread = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread.threadId as string;
  await assert.rejects(h["chat.flow_card"]!(hn.ctx, { threadId: thread, automationId: "aut_abc123", idempotencyKey: key() }), (e) => codeOf(e) === "validation.bad_input");
  const before = hn.rows(`SELECT count(*) AS n FROM chat_message WHERE thread = ? AND kind = 'system'`, thread)[0]!["n"];
  assert.equal(before, 0, "no card was left");
});
