// Reply in Thread: the thread chat.thread just made opens beside its chat from that answer alone; threads.get is not asked first (it was a second round trip before anything opened).
import test from "node:test";
import assert from "node:assert/strict";
import { createMountSample } from "./sample.ts";
import { createGo, wireConversation } from "./data.ts";
import type { Act } from "./route.ts";

test("the conversation's nav opens a new thread beside its chat with one act and no read", () => {
  const s = createMountSample();
  const acts: Act[] = [];
  const reads: string[] = [];
  const rt = { ...s.rt, call: ((cap: string, input: unknown) => { reads.push(cap); return s.rt.call(cap as never, input as never); }) as typeof s.rt.call };
  const go = createGo(rt, (a) => void acts.push(a), (id) => id, () => undefined);
  const data = wireConversation(rt, go, { threadId: "thr_parent", list: [], nameOf: (id) => id, leadId: "agt_a" });
  data.nav.openSideThread!("thr_parent", "msg_1", "thr_reply");
  assert.deepEqual(acts, [{ t: "chat", threadId: "thr_parent", focus: "msg_1", side: "thr_reply" }]);
  assert.deepEqual(reads, [], "nothing is read before the thread opens");
});
