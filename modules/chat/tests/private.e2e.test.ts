// Private chats are end to end (spec 5 b7, 2.5; ARCH 4.13, 5.10, 6.3; golden flow 13): the device seals what it says, the server stores and relays ciphertext, and the Space runtime opens a
// private thread only for a turn of its owner who let it ("Let the Space continue my chats when my computer is off"), with a key their device wrapped for it.
import test from "node:test";
import assert from "node:assert/strict";
import { x25519Pair } from "../../../kernel/src/seal/index.ts";
import { handlers } from "../impl.ts";
import { lastMessages } from "../projections.ts";
import {
  beginPrivateTurn, blockAad, bodyAad, createRuntimeKeyring, isEnvelope, keyIdOf, openText, parseEnvelope, sealText, sealedBy, threadKeyOf, wrapForRuntime,
} from "../handlers/private.ts";
import type { PrivateTurnDeps } from "../handlers/private.ts";
import { DANA, INTAKE, LEO, MAYA, assertEventsConform, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
const PERSON_KEY = Buffer.alloc(32, 0x5a);
const OTHER_KEY = Buffer.alloc(32, 0x6b);
const SECRET = "Harlow settlement: Dana Reyes accepts 250,000";
const BLOCK_SECRET = "private block text 777";
let n = 0;

/** The owner's device: it holds the person key, derives the thread key, and posts sealed messages with its own ids. */
function device(threadId: string, personKey: Uint8Array = PERSON_KEY) {
  const key = threadKeyOf(personKey, threadId);
  return {
    key,
    post(text: string, blocks: Array<{ type: string; v: number; data: unknown }> = [], id = `msg_dev${++n}${threadId.slice(4, 12)}`) {
      return {
        threadId, clientId: id, idempotencyKey: `k${id}`,
        body: text === "" ? "" : sealText(key, threadId, bodyAad(threadId, id), text),
        ...(blocks.length > 0 ? { blocks: blocks.map((b, i) => ({ type: b.type, v: b.v, data: sealText(key, threadId, blockAad(threadId, id, i), JSON.stringify(b.data)) })) } : {}),
      };
    },
  };
}

async function reasonOf(f: () => unknown): Promise<{ code: string; reason: string | undefined; next: string[] }> {
  try { await f(); } catch (e) {
    const err = (e as { error?: { code?: string; details?: { reason?: string }; next?: Array<{ kind: string }> } }).error;
    return { code: err?.code ?? "unknown", reason: err?.details?.reason, next: (err?.next ?? []).map((x) => x.kind) };
  }
  return { code: "none", reason: undefined, next: [] };
}

function optIn(personKey: Uint8Array = PERSON_KEY) {
  const runtime = x25519Pair();
  const on = new Set<string>();
  const wrapped = wrapForRuntime(runtime.pub, personKey, DANA);
  const deps: PrivateTurnDeps = { keyring: createRuntimeKeyring(runtime.priv), wrappedRuntimeKey: (p) => (on.has(p) ? wrapped : null) };
  return { deps, on, wrapped, runtime };
}

/** Everything the module's database and its events hold, as one string. */
function everything(hn: Harness): string {
  const tables = (hn.raw.all("SELECT name FROM sqlite_master WHERE type = 'table'") as Array<{ name: string }>).map((t) => t.name);
  const rows = tables.map((t) => JSON.stringify(hn.raw.all(`SELECT * FROM "${t}"`)));
  return rows.join("\n") + "\n" + JSON.stringify(hn.emitted);
}

async function startChat(hn: Harness, kind: "chat" | "ask" = "chat"): Promise<string> {
  const input = kind === "ask" ? { kind, agentIds: [INTAKE], scopeType: "record", scopeId: "rec_a1", idempotencyKey: `s${++n}` } : { kind, agentIds: [INTAKE], idempotencyKey: `s${++n}` };
  return (await h["chat.start"]!(hn.ctx, input)).thread.threadId as string;
}

test("at rest the server holds ciphertext only: the body, the blocks, every table and every event", async () => {
  const hn = harness();
  const t = await startChat(hn);
  const dev = device(t);
  const sent = await h["chat.post"]!(hn.ctx, dev.post(SECRET, [{ type: "note", v: 1, data: { text: BLOCK_SECRET } }]));
  const stored = lastMessages(hn.db, t)[0]!;
  assert.ok(isEnvelope(stored.body));
  assert.equal(stored.id, sent.message.messageId);
  assert.ok(isEnvelope(stored.blocks[0]!["data"]));
  const dump = everything(hn);
  for (const s of ["Harlow", "Dana Reyes", "250,000", "private block text", "777"]) assert.equal(dump.includes(s), false, `${s} is not anywhere on the server`);
  assert.deepEqual(assertEventsConform(hn), []);
  // the owner's key opens it; nothing else does
  assert.equal(openText(dev.key, bodyAad(t, stored.id), stored.body), SECRET);
  assert.deepEqual(JSON.parse(openText(dev.key, blockAad(t, stored.id, 0), stored.blocks[0]!["data"] as string)), { text: BLOCK_SECRET });
  assert.throws(() => openText(device(t, OTHER_KEY).key, bodyAad(t, stored.id), stored.body), "another person's key");
  assert.throws(() => openText(dev.key, bodyAad(t, "msg_other"), stored.body), "moved to another message");
  assert.throws(() => openText(dev.key, bodyAad("thr_other", stored.id), stored.body), "moved to another thread");
});

test("what other people and the API return for a private chat is the ciphertext", async () => {
  const hn = harness();
  const t = await startChat(hn);
  const dev = device(t);
  await h["chat.post"]!(hn.ctx, dev.post(SECRET));
  const envelope = parseEnvelope(lastMessages(hn.db, t)[0]!.body);
  assert.ok(envelope);
  assert.equal(envelope!.keyId, keyIdOf(dev.key, t));
  assert.equal(JSON.stringify(lastMessages(hn.db, t)).includes("Harlow"), false);
  const row = sealedBy(hn.db, t);
  assert.deepEqual([row?.owner, row?.keyId], [DANA, keyIdOf(dev.key, t)]);
  // the key tag is one way: it is not the key and does not contain it
  assert.equal(row!.keyId.length, 16);
  assert.equal(Buffer.from(row!.keyId, "base64url").equals(dev.key.subarray(0, 12)), false);
});

test("the Space runtime opens a private thread only for a turn of its owner who opted in; it reads, replies sealed, and lets go", async () => {
  const hn = harness();
  const t = await startChat(hn);
  const dev = device(t);
  await h["chat.post"]!(hn.ctx, dev.post(SECRET, [{ type: "note", v: 1, data: { text: BLOCK_SECRET } }]));
  const o = optIn();
  o.on.add(DANA);

  const turn = await beginPrivateTurn(hn.agent(INTAKE, DANA), o.deps, { threadId: t, turnId: "trn_t1" });
  const seen = turn.read();
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.body, SECRET);
  assert.deepEqual(seen[0]!.blocks[0]!["data"], { text: BLOCK_SECRET });
  const out = await turn.reply("Noted. I will draft the settlement letter.", { blocks: [{ type: "note", v: 1, data: { text: "draft started" } }] });
  const reply = lastMessages(hn.db, t).at(-1)!;
  assert.equal((out as { message: { messageId: string } }).message.messageId, reply.id);
  assert.equal(reply.author, INTAKE);
  assert.ok(isEnvelope(reply.body));
  assert.equal(everything(hn).includes("settlement letter"), false, "the answer is sealed at rest too");
  // the owner's device opens the answer with the same thread key
  assert.equal(openText(dev.key, bodyAad(t, reply.id), reply.body), "Noted. I will draft the settlement letter.");
  assert.equal(hn.named("message.received").length, 2);
  assert.deepEqual(assertEventsConform(hn), []);

  turn.end();
  assert.throws(() => turn.read(), /ended/);
  await assert.rejects(() => turn.reply("late"), /ended/);
  const rows = hn.rows("SELECT * FROM chat_private_turn");
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0]!["thread"], rows[0]!["turn"], rows[0]!["person"], rows[0]!["reads"], rows[0]!["replies"]], [t, "trn_t1", DANA, 1, 1]);
  assert.equal(typeof rows[0]!["closedAt"], "number");
  assert.equal(JSON.stringify(rows).includes("Harlow"), false, "the audit row holds ids and counts, never text");
});

test("an Ask pane is a private chat: the same seal, the same turn rules", async () => {
  const hn = harness();
  const t = await startChat(hn, "ask");
  const dev = device(t);
  await h["chat.post"]!(hn.ctx, dev.post(SECRET));
  assert.equal(sealedBy(hn.db, t)?.owner, DANA);
  const o = optIn();
  o.on.add(DANA);
  const turn = await beginPrivateTurn(hn.agent(INTAKE, DANA), o.deps, { threadId: t, turnId: "trn_ask" });
  assert.equal(turn.read()[0]!.body, SECRET);
  turn.end();
  const plain = await reasonOf(() => h["chat.post"]!(hn.ctx, { threadId: t, body: "plain words", idempotencyKey: "kp" }));
  assert.deepEqual([plain.code, plain.reason], ["validation.bad_input", "sealed_thread"]);
});

test("without the opt-in the Space cannot open the chat: it says the computer is off and points to the setting; turning it off takes the key away", async () => {
  const hn = harness();
  const t = await startChat(hn);
  await h["chat.post"]!(hn.ctx, device(t).post(SECRET));
  const o = optIn();
  const off = await reasonOf(() => beginPrivateTurn(hn.agent(INTAKE, DANA), o.deps, { threadId: t, turnId: "trn_x" }));
  assert.deepEqual([off.code, off.reason, off.next[0]], ["permission.no_grant", "runtime_opt_in", "open_settings"]);
  o.on.add(DANA);
  const turn = await beginPrivateTurn(hn.agent(INTAKE, DANA), o.deps, { threadId: t, turnId: "trn_y" });
  turn.end();
  o.on.delete(DANA);
  const again = await reasonOf(() => beginPrivateTurn(hn.agent(INTAKE, DANA), o.deps, { threadId: t, turnId: "trn_z" }));
  assert.equal(again.reason, "runtime_opt_in");
  assert.equal(hn.rows("SELECT * FROM chat_private_turn").length, 1, "refused attempts leave no row");
});

test("nobody else gets in: another person, an admin, a turn of someone else, the owner without a turn, or a thread that is not private", async () => {
  const hn = harness();
  const t = await startChat(hn);
  await h["chat.post"]!(hn.ctx, device(t).post(SECRET));
  const o = optIn();
  o.on.add(DANA);
  const attempts: Array<[string, Harness["ctx"]]> = [
    ["a person", hn.person(MAYA)],
    ["the owner as a person, not a turn", hn.ctx],
    ["an agent acting for someone else", hn.agent(INTAKE, MAYA)],
    ["a service for someone else", hn.as({ kind: "service", id: "svc_runtime" }, LEO)],
  ];
  for (const [who, ctx] of attempts) {
    const r = await reasonOf(() => beginPrivateTurn(ctx, o.deps, { threadId: t, turnId: "trn_n" }));
    assert.deepEqual([who, r.code, r.reason], [who, "permission.no_grant", "not_the_owner_turn"]);
  }
  const channel = (await h["channels.create"]!(hn.ctx, { name: "team", visibility: "public", idempotencyKey: "kc" })).channel;
  const notPrivate = await reasonOf(() => beginPrivateTurn(hn.agent(INTAKE, DANA), o.deps, { threadId: channel.mainThreadId, turnId: "trn_c" }));
  assert.equal(notPrivate.code, "validation.not_found");
  assert.equal(hn.rows("SELECT * FROM chat_private_turn").length, 0);
});

test("the wrong key is caught before anything is read: another person's key, a key that is not the Space's, and a value that is not a wrapped key", async () => {
  const hn = harness();
  const t = await startChat(hn);
  await h["chat.post"]!(hn.ctx, device(t).post(SECRET));
  const run = (deps: PrivateTurnDeps) => reasonOf(() => beginPrivateTurn(hn.agent(INTAKE, DANA), deps, { threadId: t, turnId: "trn_w" }));

  const wrongKey = optIn(OTHER_KEY);
  wrongKey.on.add(DANA);
  assert.equal((await run(wrongKey.deps)).reason, "key_mismatch");

  const good = optIn();
  good.on.add(DANA);
  const otherRuntime = x25519Pair();
  assert.equal((await run({ keyring: createRuntimeKeyring(otherRuntime.priv), wrappedRuntimeKey: () => good.wrapped })).reason, "runtime_key_unreadable");
  assert.equal((await run({ keyring: good.deps.keyring, wrappedRuntimeKey: () => "not a key" })).reason, "runtime_key_unreadable");
  assert.equal((await run({ keyring: good.deps.keyring, wrappedRuntimeKey: () => wrapForRuntime(good.runtime.pub, PERSON_KEY, MAYA) })).reason, "runtime_key_unreadable", "a key wrapped for someone else");
  assert.equal(hn.rows("SELECT * FROM chat_private_turn").length, 0);
});

test("golden 13: private chat E2E, the server cannot read, and the runtime-wrapped key opt-in", async () => {
  const trace: string[] = [];
  const step = (s: string): void => { trace.push(s); console.log(`golden13 step ${trace.length}: ${s}`); };
  const hn = harness();
  const o = optIn();

  const t = await startChat(hn);
  step("Dana starts a private chat with her agent");
  const dev = device(t);
  await h["chat.post"]!(hn.ctx, dev.post(SECRET));
  step("her device seals the first message under her key and posts it");
  assert.equal(everything(hn).includes("Harlow"), false);
  step("the server holds ciphertext only: no table and no event contains the text");
  assert.ok(sealedBy(hn.db, t));
  step("the thread is sealed: its owner and key tag are recorded, not the key");
  assert.equal((await reasonOf(() => h["chat.post"]!(hn.ctx, { threadId: t, body: "plain", idempotencyKey: "kp1" }))).reason, "sealed_thread");
  step("plain text is refused in a sealed thread");
  assert.equal((await reasonOf(() => beginPrivateTurn(hn.person(MAYA), o.deps, { threadId: t, turnId: "trn_1" }))).reason, "not_the_owner_turn");
  step("another person cannot open it, and neither can an admin");
  assert.equal((await reasonOf(() => beginPrivateTurn(hn.agent(INTAKE, DANA), o.deps, { threadId: t, turnId: "trn_2" }))).reason, "runtime_opt_in");
  step("Dana's computer is off and she has not opted in: the Space says so and offers the setting");
  o.on.add(DANA);
  step("Dana turns on 'Let the Space continue my chats when my computer is off': her device wraps her key for the Space runtime");
  const turn = await beginPrivateTurn(hn.agent(INTAKE, DANA), o.deps, { threadId: t, turnId: "trn_3" });
  assert.equal(turn.read()[0]!.body, SECRET);
  step("the runtime unwraps the key for her turn only and reads the chat");
  await turn.reply("Done, the letter is drafted.");
  step("the agent answers, and the answer is sealed under her key");
  assert.equal(everything(hn).includes("letter is drafted"), false);
  step("the server holds the answer as ciphertext too");
  turn.end();
  assert.throws(() => turn.read(), /ended/);
  step("the turn ends: the keys are wiped and the handle is dead");
  assert.equal(openText(dev.key, bodyAad(t, lastMessages(hn.db, t).at(-1)!.id), lastMessages(hn.db, t).at(-1)!.body), "Done, the letter is drafted.");
  step("her device opens the answer with her own key");
  o.on.delete(DANA);
  assert.equal((await reasonOf(() => beginPrivateTurn(hn.agent(INTAKE, DANA), o.deps, { threadId: t, turnId: "trn_4" }))).reason, "runtime_opt_in");
  step("she turns the setting off and the next turn is refused: the Space has no key");
  const rows = hn.rows("SELECT * FROM chat_private_turn");
  assert.equal(rows.length, 1);
  assert.equal(JSON.stringify(rows).includes("Harlow"), false);
  step("the audit shows one turn with ids and counts and no text");
  assert.equal(trace.length, 15);
});
