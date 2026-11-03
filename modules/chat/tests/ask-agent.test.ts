// Ask an agent about a message (owner ruling, 3 Nov 2026): in a channel agents listen until named, so a message with no @mention gets no reply. "Ask an Agent…", the quiet line and an
// edit that adds a mention all post the presser's own short reply to that exact message naming the agent: the agent answers it as if it had been mentioned, the turn runs on the presser's
// account, the usual audience checks apply, and a fixed message id makes it happen once.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DANA, INTAKE, LEO, MAYA, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { route } from "../../../lib/route.ts";
import { createTurnEngine, scriptedProvider } from "../../../agent/src/turn-engine/index.ts";
import { askPost } from "../../../apps/app/src/places/chats/conversation/askagent.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
let n = 0;
const channel = async (hn: Harness) => (await h["channels.create"]!(hn.ctx, { name: "intake", visibility: "public", memberIds: [MAYA, LEO], agentIds: [INTAKE], idempotencyKey: `c${++n}` })).channel;

test("asking on someone else's message: the presser's reply names the agent, threads to that message, and the agent answers it", async () => {
  const hn = harness();
  const c = await channel(hn);
  const t = c.mainThreadId as string;
  const maya = (await h["chat.post"]!(hn.person(MAYA), { threadId: t, body: "Did the Rivera form come back?", idempotencyKey: `p${++n}` })).message;
  assert.deepEqual(route({ agents: [{ id: INTAKE, mode: "listen" }], kind: "channel" }, { author: { kind: "person", id: MAYA }, mentions: [] }).responders, [], "nobody named: agents keep listening");
  hn.clear();
  const asked = (await h["chat.post"]!(hn.ctx, askPost(t, maya.messageId, { id: INTAKE, name: "Intake" }, DANA, `p${++n}`))).message;
  assert.deepEqual(asked.author, { kind: "person", id: DANA }, "the presser's words, credited to the presser");
  assert.equal(asked.replyTo, maya.messageId);
  const ev = hn.named("message.received")[0]!.payload as { author: { id: string }; mentions: Array<{ kind: string; id: string }> };
  assert.equal(ev.author.id, DANA);
  assert.deepEqual(ev.mentions, [{ kind: "agent", id: INTAKE }]);
  assert.deepEqual(route({ agents: [{ id: INTAKE, mode: "listen" }], kind: "channel" }, { author: { kind: "person", id: DANA }, mentions: ev.mentions as never, replyToPerson: MAYA }).responders, [INTAKE], "named, it answers, though it is a reply to Maya");
});

test("the same ask twice (a second press, or an edit that names the agent again) is one message and one reply", async () => {
  const hn = harness();
  const c = await channel(hn);
  const t = c.mainThreadId as string;
  const mine = (await h["chat.post"]!(hn.ctx, { threadId: t, body: "Can someone check the dates?", idempotencyKey: `p${++n}` })).message;
  hn.clear();
  const first = (await h["chat.post"]!(hn.ctx, askPost(t, mine.messageId, { id: INTAKE, name: "Intake" }, DANA, `p${++n}`))).message;
  const second = (await h["chat.post"]!(hn.ctx, askPost(t, mine.messageId, { id: INTAKE, name: "Intake" }, DANA, `p${++n}`))).message;
  assert.equal(second.messageId, first.messageId);
  assert.equal(hn.named("message.received").length, 1, "the agent is asked once");
});

test("the agent's turn runs on the presser's account, not the author's", async () => {
  const p = scriptedProvider({ script: () => [{ type: "text" as const, text: "The form came back Monday." }, { type: "done" as const }] });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread({ id: "C", kind: "channel", starter: "maya", agents: [{ id: "intake", mode: "listen" }] });
  engine.receive({ threadId: "C", author: { kind: "person", id: "maya" }, body: "Did the form come back?" });
  await engine.idle("C");
  assert.equal(engine.turns("C").length, 0, "unnamed: nobody answers");
  engine.receive({ threadId: "C", author: { kind: "person", id: "dana" }, body: "@Intake", mentions: [{ kind: "agent", id: "intake" }], replyToPerson: "maya" });
  await engine.idle("C");
  assert.deepEqual(engine.turns("C").map((t) => [t.agentId, t.asker]), [["intake", "dana"]]);
});
