// The audience check at the answer-posting step (agent-visibility gap 6): what a turn's tools read is compared against everyone who reads the chat. An answer built on something one of them may not
// open goes to the asker privately and the chat gets one line; an answer everyone may see is posted as it is. A check that cannot be made shares nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { PRIVATELY, screenAnswer } from "../answer-audience.ts";
import type { AnswerAudienceDeps } from "../answer-audience.ts";
import { hasReads, noteRead, takeReads } from "../../../host/src/seams/answer-reads.ts";

const DANA = "usr_dana", MAYA = "usr_maya", GUS = "usr_gus", AGENT = "agt_x";
const person = (id: string) => ({ kind: "person", id });

function deps(o: { members: string[]; channel?: "invite" | "public"; closedTo?: Record<string, string[]>; space?: string[]; noMayAll?: boolean; postFails?: boolean }) {
  const posts: Array<{ agentId: string; threadId: string; body: string; actingFor?: string }> = [];
  const asked: string[] = [];
  let n = 0;
  const d: AnswerAudienceDeps = {
    async call(cap, input, as) {
      asked.push(`${cap}:${as ?? ""}`);
      if (cap === "threads.get") return { thread: o.channel ? { kind: "channel", channelId: "chn_1", members: [] } : { kind: "chat", starter: o.members[0], members: o.members.map(person) } };
      if (cap === "channels.get") return { channel: { visibility: o.channel, members: o.members.map(person) } };
      if (cap === "access.principals.list") return { principals: (o.space ?? o.members).map((id) => ({ id })) };
      if (cap === "chat.start") return { thread: { threadId: "thr_private" } };
      throw new Error(`unexpected ${cap}`);
    },
    ...(o.noMayAll ? {} : { mayAll: (people, _a, r) => people.every((p) => !(o.closedTo?.[p] ?? []).includes(`${r.type}:${r.id}`)) }),
    postAs: async (agentId, post) => { if (o.postFails) throw new Error("down"); posts.push({ agentId, threadId: post.threadId, body: post.body, ...(post.actingFor ? { actingFor: post.actingFor } : {}) }); return {}; },
    newId: () => `msg_brg${++n}`,
  };
  return { d, posts, asked };
}
const reply = "The Henderson file says the walk-away number is 310k.";
const read = (thread: string, type: string, id: string) => noteRead({ thread, agent: AGENT, asker: DANA, resource: { type, id } });

test("an answer built on a record Gus may not open goes to Dana privately; the chat gets one line", async () => {
  const w = deps({ members: [DANA, MAYA, GUS], channel: "invite", closedTo: { [GUS]: ["record:rec_h"] } });
  read("thr_a", "record", "rec_h");
  read("thr_a", "space", "spc_1");
  const s = await screenAnswer(w.d, { threadId: "thr_a", agentId: AGENT, asker: DANA, reply });
  assert.equal(s.withheld, true);
  assert.equal(s.body, PRIVATELY);
  assert.deepEqual(s.closed, [{ type: "record", id: "rec_h" }]);
  assert.deepEqual(w.posts, [{ agentId: AGENT, threadId: "thr_private", body: reply, actingFor: DANA }], "the whole answer, in Dana's own chat with the agent");
  assert.ok(w.asked.includes(`chat.start:${DANA}`), "the private chat is Dana's");
  assert.equal(hasReads("thr_a", AGENT, DANA), false, "the turn's reads were taken");
});

test("when everyone in the chat may open what was read, the answer is posted as it is", async () => {
  const w = deps({ members: [DANA, MAYA], channel: "invite", closedTo: { [GUS]: ["record:rec_h"] } });
  read("thr_b", "record", "rec_h");
  const s = await screenAnswer(w.d, { threadId: "thr_b", agentId: AGENT, asker: DANA, reply });
  assert.deepEqual(s, { body: reply, withheld: false, closed: [] });
  assert.equal(w.posts.length, 0);
});

test("a turn that read nothing, and a chat only Dana reads, are posted as they are", async () => {
  const w = deps({ members: [DANA, GUS], closedTo: { [GUS]: ["record:rec_h"] } });
  assert.equal((await screenAnswer(w.d, { threadId: "thr_c", agentId: AGENT, asker: DANA, reply })).withheld, false);
  const alone = deps({ members: [DANA], closedTo: { [GUS]: ["record:rec_h"] } });
  read("thr_d", "record", "rec_h");
  assert.equal((await screenAnswer(alone.d, { threadId: "thr_d", agentId: AGENT, asker: DANA, reply })).withheld, false);
});

test("a public channel is read by the whole Space: everyone in it is checked, not only those present", async () => {
  const w = deps({ members: [DANA, MAYA], channel: "public", space: [DANA, MAYA, GUS], closedTo: { [GUS]: ["file:fil_1"] } });
  read("thr_e", "file", "fil_1");
  const s = await screenAnswer(w.d, { threadId: "thr_e", agentId: AGENT, asker: DANA, reply });
  assert.equal(s.withheld, true);
  assert.ok(w.asked.includes(`access.principals.list:${DANA}`));
});

test("a check that cannot be made shares nothing: no per-person answer, or no private chat to send it to", async () => {
  const w = deps({ members: [DANA, MAYA], noMayAll: true });
  read("thr_f", "record", "rec_h");
  assert.equal((await screenAnswer(w.d, { threadId: "thr_f", agentId: AGENT, asker: DANA, reply })).body, PRIVATELY);
  const down = deps({ members: [DANA, MAYA], closedTo: { [MAYA]: ["record:rec_h"] }, postFails: true });
  read("thr_g", "record", "rec_h");
  await assert.rejects(screenAnswer(down.d, { threadId: "thr_g", agentId: AGENT, asker: DANA, reply }), "the engine then posts ANSWER_HELD, never the answer");
  assert.deepEqual(takeReads("thr_g", AGENT, DANA), []);
});
