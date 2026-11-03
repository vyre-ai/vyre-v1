// A chat whose readers change gets a new engine session: the session id kept for it is forgotten and its warm processes closed, so a session that heard the private profile never answers
// once someone else reads the chat. The same readers keep the session; a first sight only records them; a chat that cannot be read opens as before.
import test from "node:test";
import assert from "node:assert/strict";
import { audienceChanged, withAudienceReset } from "../audience-reset.ts";
import { resumeId, saveResumeId } from "../cli-sessions.ts";
import { harness, NOW } from "../fixtures/harness.ts";
import type { EngineSession, SessionSpec } from "../../../agent/src/turn-engine/types.ts";

const spec = (over: Partial<SessionSpec> = {}): SessionSpec => ({ threadId: "thr_1", agent: { id: "agt_billing", mode: "lead" }, asker: "usr_olivia", turnId: "trn_1", traceId: "t", ...over } as SessionSpec);
const key = { threadId: "thr_1", agentId: "agt_billing", person: "usr_olivia", driver: "claude_code" };

function world() {
  const h = harness();
  let members = ["usr_olivia"];
  const asked: Array<string | undefined> = [];
  const dropped: string[] = [];
  const opened: string[] = [];
  const call = async (cap: string, input: unknown, as?: string): Promise<unknown> => {
    asked.push(as);
    if (cap === "threads.get") return { thread: { kind: "chat", starter: "usr_olivia", members: members.map((id) => ({ kind: "person", id })) } };
    throw new Error(`no ${cap} ${JSON.stringify(input)}`);
  };
  const open = withAudienceReset(async (s) => { opened.push(s.turnId); return {} as EngineSession; }, { db: h.db, call, now: () => NOW, drop: async (t) => { dropped.push(t); return 1; } });
  return { h, open, dropped, opened, asked, join: (p: string) => { members = [...members, p]; } };
}

test("someone joins: the kept session is forgotten and the warm one closed before the turn opens", async () => {
  const w = world();
  saveResumeId(w.h.db, key, "sess_private", NOW);
  await w.open(spec({ turnId: "t1" }));
  assert.equal(resumeId(w.h.db, key), "sess_private", "a first sight only records the readers");
  await w.open(spec({ turnId: "t2" }));
  assert.equal(resumeId(w.h.db, key), "sess_private", "the same readers keep the session");
  assert.deepEqual(w.dropped, []);
  w.join("usr_noah");
  await w.open(spec({ turnId: "t3" }));
  assert.equal(resumeId(w.h.db, key), null, "the session that heard the private profile is not resumed");
  assert.deepEqual(w.dropped, ["thr_1"]);
  assert.deepEqual(w.opened, ["t1", "t2", "t3"], "every turn still opens");
  assert.ok(w.asked.every((as) => as === "usr_olivia"), "read as the asker");
});

test("a step session with no tools and a chat that cannot be read open as before", async () => {
  const w = world();
  await w.open(spec({ tools: "none", turnId: "s1" }));
  assert.equal(w.asked.length, 0);
  const h = harness();
  const open = withAudienceReset(async () => ({} as EngineSession), { db: h.db, call: async () => { throw new Error("gone"); }, now: () => NOW });
  await open(spec());
});

test("the mark is per chat, agent and person", () => {
  const h = harness();
  assert.equal(audienceChanged(h.db, key, "a", NOW), false);
  assert.equal(audienceChanged(h.db, { ...key, agentId: "agt_intake" }, "b", NOW), false);
  assert.equal(audienceChanged(h.db, key, "b", NOW), true);
  assert.equal(audienceChanged(h.db, key, "b", NOW), false);
});
