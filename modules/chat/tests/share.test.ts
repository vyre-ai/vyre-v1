// chat.share: a message goes to another chat as a card, the chat it came from gets a line saying where it went, both link to the other chat; refusals say why and leave no card.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DANA, MAYA, codeOf, harness } from "../fixtures/harness.ts";

type Fn = (ctx: any, input: any) => Promise<any>;
const h = handlers as unknown as Record<string, Fn>;
let n = 0;
const key = (): string => `sh-${++n}`;
const cards = (hn: ReturnType<typeof harness>, thread: string) => hn.rows(`SELECT body, blocks, kind, author FROM chat_message WHERE thread = ? AND kind = 'system'`, thread);

async function world() {
  const hn = harness({ calls: { "agents.get": () => ({ agent: {} }) } });
  const dm = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], personId: MAYA, idempotencyKey: key() })).thread.threadId as string;
  const ch = (await h["channels.create"]!(hn.ctx, { name: "ops", visibility: "public", idempotencyKey: key() })).channel;
  const said = (await h["chat.post"]!(hn.person(MAYA), { threadId: dm, body: "We ship on Friday\nThe letter goes out with it.", idempotencyKey: key() })).message.messageId as string;
  return { hn, dm, ch, said };
}

test("a message is shared to a channel: a card there carries it and links back, a line here says where it went and links there", async () => {
  const { hn, dm, ch, said } = await world();
  const out = await h["chat.share"]!(hn.ctx, { threadId: dm, messageId: said, toThreadId: ch.mainThreadId, to: "#ops", idempotencyKey: key() });
  assert.equal(out.toThreadId, ch.mainThreadId);
  const there = cards(hn, ch.mainThreadId)[0]!;
  assert.equal(there["author"], DANA);
  const t = JSON.parse(String(there["blocks"]))[0].data;
  assert.equal(t.lead, "Shared");
  assert.equal(t.by, DANA);
  assert.equal(t.title, "We ship on Friday");
  assert.match(t.body, /letter goes out/, "the whole message rides along when there is more than a line");
  assert.deepEqual(t.target, { type: "thread", id: dm });
  const here = JSON.parse(String(cards(hn, dm)[0]!["blocks"]))[0].data;
  assert.equal(here.to, "#ops");
  assert.deepEqual(here.target, { type: "thread", id: ch.mainThreadId });
  assert.equal(here.body, undefined, "one line here");
});

test("a notice is not shared, nor a message to the chat it is already in; nothing is left behind", async () => {
  const { hn, dm, ch, said } = await world();
  assert.equal(codeOf(await h["chat.share"]!(hn.ctx, { threadId: dm, messageId: said, toThreadId: dm, idempotencyKey: key() }).catch((e) => e)), "validation.bad_input");
  assert.equal(codeOf(await h["chat.share"]!(hn.ctx, { threadId: dm, messageId: "msg_nope", toThreadId: ch.mainThreadId, idempotencyKey: key() }).catch((e) => e)), "validation.not_found");
  assert.equal(cards(hn, ch.mainThreadId).length, 0);
  assert.equal(cards(hn, dm).length, 0);
});
