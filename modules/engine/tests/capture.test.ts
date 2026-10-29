// Handing chats to memory (spec 2.15): a chat is captured when it closes and, once, when it has been quiet for a while; always as a person in the chat, never as a service,
// and not again until someone writes again.
import test from "node:test";
import assert from "node:assert/strict";
import { captureClosed, captureIdle, IDLE_MS, noteActivity } from "../handlers/capture.ts";
import { harness } from "../fixtures/harness.ts";
import type { EngineCtx } from "../projections.ts";

function rig(fail = false) {
  const h = harness();
  const asked: Array<{ cap: string; input: unknown; as: string | undefined }> = [];
  const call = async (cap: string, input: unknown, as?: string): Promise<unknown> => { asked.push({ cap, input, as }); if (fail) throw new Error("gone"); return { proposed: 0, merged: 0 }; };
  const ctx = h.ctx as EngineCtx;
  const wrote = (threadId: string, person = "usr_dana", kind = "person"): string[] => noteActivity(ctx, { at: h.clock.t, payload: { threadId, author: { kind, id: person } } });
  return { h, ctx, call, asked, wrote };
}

test("a chat that closes is captured at once, as the person who last wrote in it", async () => {
  const { ctx, call, asked, wrote } = rig();
  wrote("thr_a", "usr_dana");
  wrote("thr_a", "usr_omar");
  assert.deepEqual(await captureClosed(ctx, { payload: { threadId: "thr_a" } }, call), ["thr_a"]);
  assert.deepEqual(asked, [{ cap: "memory.capture", input: { threadId: "thr_a", reason: "closed" }, as: "usr_omar" }]);
});

test("a chat nobody wrote in is captured as whoever closed it, and as nobody when a service closed it", async () => {
  const { ctx, call, asked } = rig();
  assert.deepEqual(await captureClosed(ctx, { actor: "usr_dana", payload: { threadId: "thr_b" } }, call), ["thr_b"]);
  assert.equal(asked[0]?.as, "usr_dana");
  assert.deepEqual(await captureClosed(ctx, { actor: "svc_host", payload: { threadId: "thr_c" } }, call), []);
  assert.equal(asked.length, 1);
});

test("an agent's message does not start the idle clock; a person's does", () => {
  const { wrote } = rig();
  assert.deepEqual(wrote("thr_a", "agt_intake", "agent"), []);
  assert.deepEqual(wrote("thr_a"), ["thr_a"]);
});

test("a chat goes idle after IDLE_MS, is captured once, and again only after new messages", async () => {
  const { h, ctx, call, asked, wrote } = rig();
  wrote("thr_a");
  assert.deepEqual(await captureIdle(ctx, IDLE_MS, call), [], "not idle yet");
  h.clock.t += IDLE_MS + 1;
  assert.deepEqual(await captureIdle(ctx, IDLE_MS, call), ["thr_a"]);
  assert.deepEqual(await captureIdle(ctx, IDLE_MS, call), [], "read once");
  h.clock.t += 1000;
  wrote("thr_a");
  h.clock.t += IDLE_MS + 1;
  assert.deepEqual(await captureIdle(ctx, IDLE_MS, call), ["thr_a"], "new messages make it due again");
  assert.equal(asked.length, 2);
  assert.ok(asked.every((a) => a.as === "usr_dana" && (a.input as { reason: string }).reason === "idle"));
});

test("a capture that fails is not retried every minute", async () => {
  const { h, ctx, call, asked, wrote } = rig(true);
  wrote("thr_a");
  h.clock.t += IDLE_MS + 1;
  assert.deepEqual(await captureIdle(ctx, IDLE_MS, call), []);
  assert.deepEqual(await captureIdle(ctx, IDLE_MS, call), []);
  assert.equal(asked.length, 1);
});

test("without a host half nothing is captured and nothing throws", async () => {
  const { h, ctx, wrote } = rig();
  wrote("thr_a");
  h.clock.t += IDLE_MS + 1;
  assert.deepEqual(await captureIdle(ctx, IDLE_MS, null), []);
  assert.deepEqual(await captureClosed(ctx, { payload: { threadId: "thr_a" } }, null), []);
});
