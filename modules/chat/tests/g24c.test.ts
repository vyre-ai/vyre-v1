// Group c of the chat handlers: message reads, edit, delete, reactions, pins, Recent, composer suggestions and open_tab, against the frozen contract.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { handlers } from "../impl.ts";
import { g24cHandlers } from "../handlers/g24c.ts";
import { DANA, DRAFTER, INTAKE, LEO, MAYA, assertEventsConform, contractErrors, failure, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

type Fn = (ctx: Harness["ctx"], input: any) => Promise<any>;
const g = g24cHandlers as unknown as Record<string, Fn>;
const base = handlers as unknown as Record<string, Fn>;
const OURS = ["chat.messages.list", "chat.message.get", "chat.edit", "chat.delete_message", "chat.react", "chat.pin", "chat.unpin", "chat.pins.list", "chat.recent", "chat.open_tab", "chat.composer.suggest"];
let n = 0;
const key = () => `g${++n}`;

const chat = async (hn: Harness, agents: string[] = [INTAKE]) => (await base["chat.start"]!(hn.ctx, { kind: "chat", agentIds: agents, idempotencyKey: key() })).thread.threadId as string;
const say = async (ctx: Harness["ctx"], threadId: string, body: string) => (await base["chat.post"]!(ctx, { threadId, body, idempotencyKey: key() })).message.messageId as string;
const room = async (hn: Harness) => (await base["channels.create"]!(hn.ctx, { name: "intake", visibility: "public", memberIds: [MAYA], agentIds: [INTAKE], topic: "New matters", idempotencyKey: key() })).channel;

/** Run a capability, check its input and answer against the contract and that every event is declared and conforms. */
async function run(hn: Harness, cap: string, ctx: Harness["ctx"], input: Record<string, unknown>) {
  assert.deepEqual(contractErrors(cap, "in", input), [], `${cap}: input`);
  hn.clear();
  const out = await g[cap]!(ctx, input);
  assert.deepEqual(contractErrors(cap, "out", out), [], `${cap}: answer`);
  const def = registry.capabilities.find((c) => c.name === cap)!;
  for (const e of hn.emitted) assert.ok((def.emits as readonly string[]).includes(e.name), `${cap} emitted undeclared ${e.name}`);
  assert.deepEqual(assertEventsConform(hn), [], cap);
  return out;
}

test("the table holds exactly the eleven capabilities, all frozen chat capabilities, and each example input is valid", () => {
  assert.deepEqual(Object.keys(g).sort(), [...OURS].sort());
  for (const name of OURS) {
    const cap = registry.capabilities.find((c) => c.name === name && c.module === "chat")!;
    assert.ok(cap, name);
    assert.ok(cap.examples.length > 0, `${name} has an example`);
    for (const ex of cap.examples) assert.deepEqual(contractErrors(name, "in", ex.input), [], `${name}: example ${ex.name}`);
  }
});

test("messages.list gives the newest window oldest first, pages backwards and forwards, and hides deleted messages", async () => {
  const hn = harness();
  const t = await chat(hn);
  const ids: string[] = [];
  for (let i = 1; i <= 7; i++) ids.push(await say(hn.ctx, t, `m${i}`));
  const last = await run(hn, "chat.messages.list", hn.ctx, { threadId: t, limit: 3 });
  assert.deepEqual(last.messages.map((m: any) => m.body), ["m5", "m6", "m7"]);
  assert.equal(last.hasMore, true);
  assert.equal(last.messages[0].enc, 2);
  const older = await run(hn, "chat.messages.list", hn.ctx, { threadId: t, before: 5, limit: 3 });
  assert.deepEqual(older.messages.map((m: any) => m.threadSeq), [2, 3, 4]);
  assert.equal(older.hasMore, true);
  const fwd = await run(hn, "chat.messages.list", hn.ctx, { threadId: t, after: 5 });
  assert.deepEqual(fwd.messages.map((m: any) => m.threadSeq), [6, 7]);
  assert.equal(fwd.hasMore, false);
  await run(hn, "chat.delete_message", hn.ctx, { threadId: t, messageId: ids[6] });
  assert.deepEqual((await run(hn, "chat.messages.list", hn.ctx, { threadId: t, limit: 2 })).messages.map((m: any) => m.body), ["m5", "m6"]);
  assert.equal(await failure(() => g["chat.messages.list"]!(hn.ctx, { threadId: t, limit: 0 })), "validation.bad_input");
  assert.equal(await failure(() => g["chat.messages.list"]!(hn.ctx, { threadId: "thr_none" })), "validation.not_found");
  assert.equal(await failure(() => g["chat.messages.list"]!(hn.person(MAYA), { threadId: t })), "validation.not_found", "a private chat is not readable by others");
});

test("message.get returns one message with its blocks, only from its own thread", async () => {
  const hn = harness();
  const t = await chat(hn), u = await chat(hn);
  const q = hn.seedQuestion(t, { mode: "free" });
  const got = await run(hn, "chat.message.get", hn.ctx, { threadId: t, messageId: q.messageId });
  assert.equal(got.message.blocks[0].type, "question");
  assert.equal(await failure(() => g["chat.message.get"]!(hn.ctx, { threadId: u, messageId: q.messageId })), "validation.not_found");
  assert.equal(await failure(() => g["chat.message.get"]!(hn.ctx, { threadId: t, messageId: "msg_none" })), "validation.not_found");
});

test("edit changes the text of your own message, marks editedAt, and does nothing when the text is the same", async () => {
  const hn = harness();
  const t = await chat(hn);
  const m = await say(hn.ctx, t, "first");
  hn.advance(1000);
  const out = await run(hn, "chat.edit", hn.ctx, { threadId: t, messageId: m, body: "second" });
  assert.equal(out.message.body, "second");
  assert.equal(out.message.editedAt, hn.clock.t);
  assert.deepEqual(hn.names(), ["message.edited"]);
  const again = await run(hn, "chat.edit", hn.ctx, { threadId: t, messageId: m, body: "second" });
  assert.equal(again.message.editedAt, hn.clock.t);
  assert.deepEqual(hn.names(), []);
  // a sealed chat stores what the device sends, as given
  const sealed = await run(hn, "chat.edit", hn.ctx, { threadId: t, messageId: m, body: "v1:ZmFrZS1jaXBoZXJ0ZXh0" });
  assert.equal(sealed.message.body, "v1:ZmFrZS1jaXBoZXJ0ZXh0");
  assert.equal(sealed.message.enc, 2);
});

test("edit refuses another person's message, an empty text, a system line, and a missing message", async () => {
  const hn = harness();
  const c = await room(hn);
  const m = await say(hn.ctx, c.mainThreadId, "mine");
  assert.equal(await failure(() => g["chat.edit"]!(hn.person(MAYA), { threadId: c.mainThreadId, messageId: m, body: "hijack" })), "permission.no_grant");
  assert.equal(await failure(() => g["chat.edit"]!(hn.ctx, { threadId: c.mainThreadId, messageId: m, body: "   " })), "validation.bad_input");
  assert.equal(await failure(() => g["chat.edit"]!(hn.ctx, { threadId: c.mainThreadId, messageId: "msg_none", body: "x" })), "validation.not_found");
  hn.raw.run("UPDATE chat_message SET kind = 'system' WHERE id = ?", m);
  assert.equal(await failure(() => g["chat.edit"]!(hn.ctx, { threadId: c.mainThreadId, messageId: m, body: "x" })), "validation.bad_input");
});

test("delete keeps the row marked, emits once, answers the same on a repeat, and is for the author only", async () => {
  const hn = harness();
  const c = await room(hn);
  const m = await say(hn.ctx, c.mainThreadId, "oops");
  assert.equal(await failure(() => g["chat.delete_message"]!(hn.person(MAYA), { threadId: c.mainThreadId, messageId: m })), "permission.no_grant");
  assert.deepEqual(await run(hn, "chat.delete_message", hn.ctx, { threadId: c.mainThreadId, messageId: m }), { deleted: true });
  assert.deepEqual(hn.names(), ["message.deleted"]);
  assert.notEqual(hn.rows("SELECT deleted_at FROM chat_message WHERE id = ?", m)[0]!["deleted_at"], null);
  assert.deepEqual(await run(hn, "chat.delete_message", hn.ctx, { threadId: c.mainThreadId, messageId: m }), { deleted: true });
  assert.deepEqual(hn.names(), []);
  assert.equal(await failure(() => g["chat.delete_message"]!(hn.ctx, { threadId: c.mainThreadId, messageId: "msg_none" })), "validation.not_found");
  assert.equal(await failure(() => g["chat.message.get"]!(hn.ctx, { threadId: c.mainThreadId, messageId: m })), "validation.not_found");
});

test("react adds and removes a reaction per person, and a repeat changes nothing", async () => {
  const hn = harness();
  const c = await room(hn);
  const m = await say(hn.ctx, c.mainThreadId, "nice");
  let out = await run(hn, "chat.react", hn.ctx, { threadId: c.mainThreadId, messageId: m, emoji: "thumbs_up" });
  assert.deepEqual(out.reactions, [{ emoji: "thumbs_up", by: [DANA] }]);
  assert.deepEqual(hn.named("message.reacted").map((e) => e.payload["removed"]), [false]);
  out = await run(hn, "chat.react", hn.ctx, { threadId: c.mainThreadId, messageId: m, emoji: "thumbs_up" });
  assert.deepEqual(hn.names(), []);
  out = await run(hn, "chat.react", hn.person(MAYA), { threadId: c.mainThreadId, messageId: m, emoji: "thumbs_up" });
  assert.deepEqual(out.reactions, [{ emoji: "thumbs_up", by: [DANA, MAYA] }]);
  out = await run(hn, "chat.react", hn.ctx, { threadId: c.mainThreadId, messageId: m, emoji: "thumbs_up", remove: true });
  assert.deepEqual(out.reactions, [{ emoji: "thumbs_up", by: [MAYA] }]);
  assert.deepEqual(hn.named("message.reacted").map((e) => e.payload["removed"]), [true]);
  out = await run(hn, "chat.react", hn.person(MAYA), { threadId: c.mainThreadId, messageId: m, emoji: "thumbs_up", remove: true });
  assert.deepEqual(out.reactions, []);
  out = await run(hn, "chat.react", hn.ctx, { threadId: c.mainThreadId, messageId: m, emoji: "heart", remove: true });
  assert.deepEqual(hn.names(), []);
  assert.equal(await failure(() => g["chat.react"]!(hn.ctx, { threadId: c.mainThreadId, messageId: m, emoji: "  " })), "validation.bad_input");
  assert.equal(await failure(() => g["chat.react"]!(hn.ctx, { threadId: c.mainThreadId, messageId: "msg_none", emoji: "x" })), "validation.not_found");
  const t = await chat(hn);
  const mid = await say(hn.ctx, t, "x");
  assert.equal(await failure(() => g["chat.react"]!(hn.person(LEO), { threadId: t, messageId: mid, emoji: "x" })), "validation.not_found");
});

test("pin and unpin set the marker, emit only on a change, and pins.list shows the pinned messages in order", async () => {
  const hn = harness();
  const c = await room(hn);
  const a = await say(hn.ctx, c.mainThreadId, "a"), b = await say(hn.ctx, c.mainThreadId, "b"), d = await say(hn.ctx, c.mainThreadId, "d");
  assert.deepEqual(await run(hn, "chat.pin", hn.ctx, { threadId: c.mainThreadId, messageId: d }), { pinned: true });
  assert.deepEqual(hn.named("message.pinned").map((e) => e.payload["pinned"]), [true]);
  await run(hn, "chat.pin", hn.ctx, { threadId: c.mainThreadId, messageId: d });
  assert.deepEqual(hn.names(), []);
  await run(hn, "chat.pin", hn.ctx, { threadId: c.mainThreadId, messageId: a });
  const pins = await run(hn, "chat.pins.list", hn.ctx, { threadId: c.mainThreadId });
  assert.deepEqual(pins.messages.map((m: any) => m.body), ["a", "d"]);
  assert.deepEqual(await run(hn, "chat.unpin", hn.ctx, { threadId: c.mainThreadId, messageId: a }), { pinned: false });
  assert.deepEqual(hn.named("message.pinned").map((e) => e.payload["pinned"]), [false]);
  await run(hn, "chat.unpin", hn.ctx, { threadId: c.mainThreadId, messageId: b });
  assert.deepEqual(hn.names(), []);
  assert.deepEqual((await run(hn, "chat.pins.list", hn.ctx, { threadId: c.mainThreadId })).messages.map((m: any) => m.body), ["d"]);
  assert.equal(await failure(() => g["chat.pin"]!(hn.ctx, { threadId: c.mainThreadId, messageId: "msg_none" })), "validation.not_found");
  assert.equal(await failure(() => g["chat.unpin"]!(hn.ctx, { threadId: "thr_none", messageId: b })), "validation.not_found");
  assert.equal(await failure(() => g["chat.pins.list"]!(hn.ctx, { threadId: "thr_none" })), "validation.not_found");
});

test("recent groups the asker's threads by day with the newest first, shows no preview of a sealed chat, and filters", async () => {
  const hn = harness();
  const dm = (await base["chat.start"]!(hn.ctx, { kind: "chat", personId: MAYA, idempotencyKey: key() })).thread.threadId as string;
  const priv = await chat(hn);
  const c = await room(hn);
  await say(hn.ctx, priv, "sealed words");
  hn.advance(1000);
  await say(hn.ctx, c.mainThreadId, "channel news");
  hn.advance(2 * 86_400_000);
  const r = await run(hn, "chat.recent", hn.ctx, {});
  assert.deepEqual(r.starred, []);
  assert.deepEqual(r.today, []);
  assert.deepEqual(r.yesterday, []);
  assert.deepEqual(r.earlier.map((x: any) => x.threadId), [c.mainThreadId, priv, dm]);
  assert.equal(r.earlier[0].title, "intake");
  assert.equal(r.earlier[0].preview, "channel news");
  assert.equal(r.earlier[1].preview, undefined);
  assert.equal(r.nextUnread, null);
  hn.advance(-2 * 86_400_000 + 5000);
  assert.deepEqual((await run(hn, "chat.recent", hn.ctx, {})).today.length, 3);
  assert.deepEqual((await run(hn, "chat.recent", hn.ctx, { filter: "people" })).today.map((x: any) => x.threadId).sort(), [c.mainThreadId, dm].sort());
  assert.deepEqual((await run(hn, "chat.recent", hn.ctx, { filter: "agents" })).today.map((x: any) => x.threadId).sort(), [c.mainThreadId, priv].sort());
  assert.deepEqual((await run(hn, "chat.recent", hn.ctx, { filter: "unread" })).today, []);
  const other = await run(hn, "chat.recent", hn.person(LEO), {});
  assert.equal(other.today.length + other.yesterday.length + other.earlier.length, 0, "nothing of Dana's is in Leo's list");
  assert.equal(await failure(() => g["chat.recent"]!(hn.ctx, { filter: "all" })), "none");
});

test("composer.suggest lists the people and agents of a thread, and the channels the asker can see", async () => {
  const hn = harness();
  const c = await room(hn);
  await base["channels.create"]!(hn.person(MAYA), { name: "secret", visibility: "invite", idempotencyKey: key() });
  const at = await run(hn, "chat.composer.suggest", hn.ctx, { symbol: "@", q: "", threadId: c.mainThreadId });
  assert.deepEqual(at.items.map((i: any) => [i.group, i.kind, i.id]), [["People", "person", DANA], ["People", "person", MAYA], ["Agents", "agent", INTAKE]]);
  assert.deepEqual((await run(hn, "chat.composer.suggest", hn.ctx, { symbol: "@", q: "@mai", threadId: c.mainThreadId })).items.map((i: any) => i.id), [MAYA]);
  assert.ok((await run(hn, "chat.composer.suggest", hn.ctx, { symbol: "@", q: "intake" })).items.some((i: any) => i.id === INTAKE));
  const hash = await run(hn, "chat.composer.suggest", hn.ctx, { symbol: "#", q: "" });
  assert.deepEqual(hash.items.map((i: any) => [i.title, i.detail]), [["intake", "New matters"]]);
  assert.deepEqual((await run(hn, "chat.composer.suggest", hn.ctx, { symbol: "#", q: "#zzz" })).items, []);
  assert.deepEqual((await run(hn, "chat.composer.suggest", hn.ctx, { symbol: "/", q: "" })).items, []);
  assert.equal(await failure(() => g["chat.composer.suggest"]!(hn.ctx, { symbol: "@", q: "", threadId: "thr_none" })), "validation.not_found");
  const t = await chat(hn);
  assert.equal(await failure(() => g["chat.composer.suggest"]!(hn.person(LEO), { symbol: "@", q: "", threadId: t })), "validation.not_found");
});

test("open_tab by an agent tells the person's devices, leaves a tab_opened line, and hides the title in a sealed chat", async () => {
  const hn = harness();
  const c = await room(hn);
  const out = await run(hn, "chat.open_tab", hn.agent(INTAKE, DANA), { threadId: c.mainThreadId, targetType: "file", targetId: "fil_a1", title: "Notes" });
  assert.deepEqual(out, { opened: true });
  assert.deepEqual(hn.names(), ["tab.opened", "message.received"]);
  assert.deepEqual(hn.named("tab.opened")[0]!.payload, { threadId: c.mainThreadId, personId: DANA, targetType: "file", targetId: "fil_a1", agentId: INTAKE });
  const line = (await g["chat.messages.list"]!(hn.ctx, { threadId: c.mainThreadId })).messages[0];
  assert.equal(line.blocks[0].type, "tab_opened");
  assert.equal(line.blocks[0].data.title, "Notes");
  const t = await chat(hn);
  await run(hn, "chat.open_tab", hn.agent(INTAKE, DANA), { threadId: t, targetType: "file", targetId: "fil_a1", title: "Secret plan" });
  assert.equal((await g["chat.messages.list"]!(hn.ctx, { threadId: t })).messages[0].blocks[0].data.title, "file");
});

test("open_tab refuses a person, an agent outside the chat, an agent with no person, a missing thread and empty targets", async () => {
  const hn = harness();
  const t = await chat(hn);
  const input = { threadId: t, targetType: "file", targetId: "fil_a1" };
  assert.equal(await failure(() => g["chat.open_tab"]!(hn.ctx, input)), "validation.bad_input");
  assert.equal(await failure(() => g["chat.open_tab"]!(hn.agent(DRAFTER, DANA), input)), "validation.not_found");
  assert.equal(await failure(() => g["chat.open_tab"]!(hn.as({ kind: "agent", id: INTAKE }), input)), "validation.bad_input");
  assert.equal(await failure(() => g["chat.open_tab"]!(hn.agent(INTAKE, DANA), { ...input, threadId: "thr_none" })), "validation.not_found");
  assert.equal(await failure(() => g["chat.open_tab"]!(hn.agent(INTAKE, DANA), { ...input, targetId: " " })), "validation.bad_input");
});
