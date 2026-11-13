// The caller shares a read that is already out, never across a write, and lets the reads that open a chat go before the others (opening a chat sent the same read three or four times and queued the thread behind forty others).
import test from "node:test";
import assert from "node:assert/strict";
import { createCapCaller } from "./index.ts";
import type { RouteRow } from "./index.ts";

const row = (cap: string, effects: "read" | "write"): RouteRow => ({ method: "POST", path: `/v1/${cap.replaceAll(".", "/")}`, cap, v: 1, effects, idempotency: "none" } as unknown as RouteRow);
const ROUTES = [row("stars.list", "read"), row("threads.get", "read"), row("chat.messages.list", "read"), row("chat.post", "write"), row("agents.list", "read")];

function world() {
  const sent: { cap: string; done: () => void }[] = [];
  const fetchFn = ((url: string) => new Promise((resolve) => {
    const cap = String(url).replace(/^.*\/v1\//, "").replaceAll("/", ".");
    sent.push({ cap, done: () => resolve({ status: 200, headers: { get: () => null }, json: async () => ({ data: { cap } }) }) });
  })) as unknown as typeof fetch;
  const call = createCapCaller({ baseUrl: "http://x", token: () => "t", fetch: fetchFn, routes: async () => ROUTES });
  return { call, sent };
}
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

test("the same read asked for four times while it is out is one request, and every asker gets the answer", async () => {
  const w = world();
  const all = [w.call("stars.list", {}), w.call("stars.list", {}), w.call("stars.list", {}), w.call("stars.list", {})];
  await tick();
  assert.equal(w.sent.length, 1);
  w.sent[0]!.done();
  const out = await Promise.all(all);
  assert.deepEqual(out, [{ cap: "stars.list" }, { cap: "stars.list" }, { cap: "stars.list" }, { cap: "stars.list" }]);
  void w.call("stars.list", {}); await tick();
  assert.equal(w.sent.length, 2, "once it has answered, a new ask is a new request");
});

test("different input is a different read, and a write between two asks ends the sharing", async () => {
  const w = world();
  void w.call("stars.list", { a: 1 }); void w.call("stars.list", { a: 2 }); await tick();
  assert.equal(w.sent.length, 2);
  const w2 = world();
  void w2.call("stars.list", {}); await tick();
  void w2.call("chat.post", { threadId: "t", body: "x" }); await tick();
  void w2.call("stars.list", {}); await tick();
  assert.deepEqual(w2.sent.map((s) => s.cap), ["stars.list", "chat.post", "stars.list"], "a read asked for after a change is not answered by one that started before it");
});

test("a write is never shared", async () => {
  const w = world();
  void w.call("chat.post", { threadId: "t", body: "x" }); void w.call("chat.post", { threadId: "t", body: "x" }); await tick();
  assert.equal(w.sent.length, 2);
});

test("while the thread and its messages are out, other reads wait; they go when both have answered", async () => {
  const w = world();
  void w.call("threads.get", { threadId: "t" }); void w.call("chat.messages.list", { threadId: "t" });
  void w.call("agents.list", {}); void w.call("stars.list", {});
  await tick();
  assert.deepEqual(w.sent.map((s) => s.cap), ["threads.get", "chat.messages.list"], "the two that paint go first");
  w.sent[0]!.done(); await tick();
  assert.equal(w.sent.length, 2, "one still out: the others keep waiting");
  w.sent[1]!.done(); await tick();
  assert.deepEqual(w.sent.map((s) => s.cap).slice(2).sort(), ["agents.list", "stars.list"], "then the rest");
});
