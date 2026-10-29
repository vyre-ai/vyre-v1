import test from "node:test";
import assert from "node:assert/strict";
import { createRecorder } from "./recorder.ts";
import type { Sample, Uploader } from "./recorder.ts";

const timers = () => { const q: (() => void)[] = []; return { setTimer: (f: () => void) => { q.push(f); return q.length; }, clearTimer: () => undefined, fire: async () => { const f = q.splice(0); for (const x of f) x(); await new Promise((r) => setTimeout(r, 0)); } }; };
const uploader = (spaceId: string, over: Partial<Uploader> = {}) => { const got: Sample[][] = []; return { got, u: { spaceId, ready: () => true, upload: async (s: Sample[]) => { got.push(s); }, ...over } as Uploader }; };

test("a sample is sent only by the session of the Space it was measured in", async () => {
  const t = timers(), r = createRecorder({ now: () => 5, ...t });
  const a = uploader("spc_a"), b = uploader("spc_b");
  r.attach(a.u); r.attach(b.u);
  r.record("spc_a", "startup", 800); r.record("spc_b", "search", 12);
  await r.flush();
  assert.deepEqual(a.got, [[{ budgetId: "startup", value: 800, at: 5 }]]);
  assert.deepEqual(b.got, [[{ budgetId: "search", value: 12, at: 5 }]]);
  assert.equal(r.pending(), 0);
});

test("a Space that is signed out or unreachable keeps its samples, and sends them when it can, never to another Space", async () => {
  const t = timers(), r = createRecorder({ ...t });
  let up = false; const a = uploader("spc_a", { ready: () => up }), other = uploader("spc_b");
  r.attach(a.u); r.attach(other.u);
  r.record("spc_a", "startup", 700);
  await r.flush();
  assert.deepEqual([a.got.length, other.got.length, r.pending("spc_a")], [0, 0, 1], "kept while the Space cannot be reached");
  up = true; await r.flush();
  assert.deepEqual([a.got.length, other.got.length, r.pending()], [1, 0, 0]);
});

test("a failed upload keeps the batch for the next try; a session that left sends nothing; bad values are not recorded; the queue is bounded", async () => {
  const t = timers(), r = createRecorder({ ...t });
  let fail = true; const a = uploader("spc_a", { upload: async () => { if (fail) throw new Error("offline"); } });
  const off = r.attach(a.u);
  r.record("spc_a", "startup", 1); r.record("spc_a", "startup", NaN); r.record("spc_a", "startup", -2); r.record("", "startup", 1);
  assert.equal(r.pending("spc_a"), 1);
  await r.flush(); assert.equal(r.pending("spc_a"), 1, "kept after a failed upload");
  fail = false; off(); await r.flush(); assert.equal(r.pending("spc_a"), 1, "a session that left sends nothing");
  for (let i = 0; i < 500; i++) r.record("spc_a", "edit", i);
  assert.equal(r.pending("spc_a"), 200, "bounded per Space");
});
