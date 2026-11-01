// chat.remember: a message becomes a fact in the memory of the chat's project (else the person's own), sourced to the message, with a card in the thread; refusals say why and leave no card.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { factText } from "../handlers/remember.ts";
import { DANA, INTAKE, MAYA, codeOf, harness } from "../fixtures/harness.ts";

type Fn = (ctx: any, input: any) => Promise<any>;
const h = handlers as unknown as Record<string, Fn>;
let n = 0;
const key = (): string => `rm-${++n}`;
const asked: Record<string, unknown>[] = [];
const PROJECT = { projectId: "prj_rivera", recordId: "rec_rivera", channelId: "chn_rivera", title: "Rivera matter" };

function world(o: { merged?: boolean; projects?: unknown[]; noEdit?: boolean } = {}) {
  asked.length = 0;
  return harness({ calls: {
    "agents.get": () => ({ agent: {} }),
    "projects.list": () => ({ projects: o.projects ?? [PROJECT] }),
    "memory.fact.accept": () => { if (o.noEdit) throw new Error("no grant"); return { fact: {} }; },
    "memory.remember": (i) => { asked.push(i); return { fact: { factId: "fct_1", layer: i["layer"] ?? "person" }, merged: o.merged ?? true }; },
  } });
}
const cards = (hn: ReturnType<typeof harness>, thread: string) => hn.rows(`SELECT body, blocks FROM chat_message WHERE thread = ? AND kind = 'system'`, thread).map((r) => ({ body: String(r["body"]), block: JSON.parse(String(r["blocks"]))[0] }));

test("the words of a message are one line, cut at 400 letters", () => {
  assert.equal(factText("  We go with\n the Tuesday   launch  "), "We go with the Tuesday launch");
  assert.equal(factText("x".repeat(500)).length, 400);
});

test("in a project's chat a message is remembered at the project layer, sourced to the message, with a card that names the project", async () => {
  const hn = world();
  const thread = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], recordId: "rec_rivera", idempotencyKey: key() })).thread.threadId as string;
  const said = (await h["chat.post"]!(hn.ctx, { threadId: thread, body: "We go with the Tuesday launch.", idempotencyKey: key() })).message.messageId as string;
  const out = await h["chat.remember"]!(hn.ctx, { threadId: thread, messageId: said, idempotencyKey: key() });
  assert.deepEqual(asked[0], { text: "We go with the Tuesday launch.", threadId: thread, sourceRef: said, layer: "project", projectId: "prj_rivera" });
  assert.equal(out.layer, "project");
  assert.equal(out.projectTitle, "Rivera matter");
  const card = cards(hn, thread)[0]!;
  assert.equal(card.block.type, "link_card");
  assert.deepEqual(card.block.data, { icon: "fact", lead: "Remembered for Rivera matter", title: "We go with the Tuesday launch.", target: { type: "fact", id: "fct_1" } });
});

test("a chat with no project remembers into the person's own layer; a fact that waits for a yes is proposed, not remembered", async () => {
  const hn = world({ projects: [] });
  const dm = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], personId: MAYA, idempotencyKey: key() })).thread.threadId as string;
  const said = (await h["chat.post"]!(hn.ctx, { threadId: dm, body: "Friday works for me", idempotencyKey: key() })).message.messageId as string;
  const out = await h["chat.remember"]!(hn.ctx, { threadId: dm, messageId: said, idempotencyKey: key() });
  assert.equal(out.layer, "person");
  assert.equal(asked[0]!["layer"], undefined);
  assert.equal(asked[0]!["agentId"], undefined, "a chat with no agent has none to keep it for");
  const withAgent = world({ projects: [] });
  const t4 = (await h["chat.start"]!(withAgent.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread.threadId as string;
  const m4 = (await h["chat.post"]!(withAgent.ctx, { threadId: t4, body: "I prefer Fridays", idempotencyKey: key() })).message.messageId as string;
  await h["chat.remember"]!(withAgent.ctx, { threadId: t4, messageId: m4, idempotencyKey: key() });
  assert.equal(asked[0]!["agentId"], INTAKE, "kept for the agent that leads the chat, which is the one recall reads for");
  assert.equal(cards(hn, dm)[0]!.block.data.lead, "Remembered");
  const waiting = world({ merged: false, noEdit: true });
  const t2 = (await h["chat.start"]!(waiting.ctx, { kind: "chat", agentIds: [INTAKE], recordId: "rec_rivera", idempotencyKey: key() })).thread.threadId as string;
  const m2 = (await h["chat.post"]!(waiting.ctx, { threadId: t2, body: "Budget is 5k", idempotencyKey: key() })).message.messageId as string;
  await h["chat.remember"]!(waiting.ctx, { threadId: t2, messageId: m2, idempotencyKey: key() });
  assert.equal(cards(waiting, t2)[0]!.block.data.lead, "Proposed to Rivera matter");
  const edits = world({ merged: false });
  const t3 = (await h["chat.start"]!(edits.ctx, { kind: "chat", agentIds: [INTAKE], recordId: "rec_rivera", idempotencyKey: key() })).thread.threadId as string;
  const m3 = (await h["chat.post"]!(edits.ctx, { threadId: t3, body: "Budget is 6k", idempotencyKey: key() })).message.messageId as string;
  assert.equal((await h["chat.remember"]!(edits.ctx, { threadId: t3, messageId: m3, idempotencyKey: key() })).merged, true, "a person who may edit the project is not held back");
  assert.equal(cards(edits, t3)[0]!.block.data.lead, "Remembered for Rivera matter");
});

test("a project channel's chat counts as the project too; an agent may remember for the person it acts for", async () => {
  const hn = world();
  const ch = (await h["channels.create"]!(hn.ctx, { name: "rivera", visibility: "public", idempotencyKey: key() })).channel;
  hn.ctx.db.run(`UPDATE chat_channel SET "recordId" = ? WHERE id = ?`, "rec_rivera", ch.channelId);
  const said = (await h["chat.post"]!(hn.ctx, { threadId: ch.mainThreadId, body: "Decision: sign on Monday", idempotencyKey: key() })).message.messageId as string;
  await h["chat.remember"]!(hn.agent(INTAKE, DANA), { threadId: ch.mainThreadId, messageId: said, idempotencyKey: key() });
  assert.equal(asked[0]!["projectId"], "prj_rivera");
});

test("refusals leave no fact and no card", async () => {
  const hn = world();
  const dm = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], personId: MAYA, idempotencyKey: key() })).thread.threadId as string;
  const said = (await h["chat.post"]!(hn.ctx, { threadId: dm, body: "hello", idempotencyKey: key() })).message.messageId as string;
  const solo = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread.threadId as string;
  await assert.rejects(h["chat.remember"]!(hn.ctx, { threadId: solo, messageId: said, idempotencyKey: key() }), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(h["chat.remember"]!(hn.person("usr_stranger"), { threadId: dm, messageId: said, idempotencyKey: key() }), (e) => codeOf(e) === "validation.not_found");
  hn.ctx.db.run(`UPDATE chat_message SET body = '   ' WHERE id = ?`, said);
  await assert.rejects(h["chat.remember"]!(hn.ctx, { threadId: dm, messageId: said, idempotencyKey: key() }), (e) => codeOf(e) === "validation.bad_input", "no words, nothing to remember");
  assert.equal(asked.length, 0);
  assert.equal(cards(hn, dm).length, 0);
});
