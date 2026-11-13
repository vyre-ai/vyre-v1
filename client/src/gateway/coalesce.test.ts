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

test("a write is never held behind the thread and its messages, however slow they are", async () => {
  const w = world();
  void w.call("threads.get", { threadId: "t" }); void w.call("chat.messages.list", { threadId: "t" });
  void w.call("chat.post", { threadId: "t", body: "x" });
  await tick();
  assert.deepEqual(w.sent.map((s) => s.cap), ["threads.get", "chat.messages.list", "chat.post"], "the write went out at once, while both reads were still out");
});

test("a read on another screen waits for a slow chat load for 400 ms at most, not longer", async () => {
  const w = world();
  void w.call("threads.get", { threadId: "t" }); void w.call("chat.messages.list", { threadId: "t" });
  void w.call("agents.list", {});
  await tick();
  assert.equal(w.sent.length, 2, "held while the chat loads");
  await new Promise((r) => setTimeout(r, 480));
  assert.deepEqual(w.sent.map((s) => s.cap), ["threads.get", "chat.messages.list", "agents.list"], "the chat never answered, and the other read went out anyway");
});

test("a shared read is never handed to a call with other arguments or another session", async () => {
  const w = world();
  void w.call("threads.get", { threadId: "a" }); void w.call("threads.get", { threadId: "b" }); void w.call("threads.get", { threadId: "a", extra: 1 });
  await tick();
  assert.equal(w.sent.length, 3, "three different argument sets are three requests");
  // another session has its own caller: the same read there is its own request, with its own token
  const tokens: string[] = [];
  const fetchFn = ((url: string, init: { headers: Record<string, string> }) => { tokens.push(init.headers["authorization"] ?? ""); return new Promise(() => undefined); }) as unknown as typeof fetch;
  const mk = (token: string) => createCapCaller({ baseUrl: "http://x", token: () => token, fetch: fetchFn, routes: async () => ROUTES });
  const alice = mk("tok_alice"), bob = mk("tok_bob");
  void alice("stars.list", {}); void bob("stars.list", {});
  await tick();
  assert.deepEqual(tokens.sort(), ["Bearer tok_alice", "Bearer tok_bob"], "each person's read went out with their own token");
  // one caller whose token changes while a read is out (a sign-out and sign-in): the new token's read is not answered by the old one's
  let current = "tok_one"; const seen: string[] = [];
  const f2 = ((url: string, init: { headers: Record<string, string> }) => { seen.push(init.headers["authorization"] ?? ""); return new Promise(() => undefined); }) as unknown as typeof fetch;
  const c = createCapCaller({ baseUrl: "http://x", token: () => current, fetch: f2, routes: async () => ROUTES });
  void c("stars.list", {}); await tick(); current = "tok_two"; void c("stars.list", {}); await tick();
  assert.deepEqual(seen, ["Bearer tok_one", "Bearer tok_two"]);
});

// (a) scope: exactly which calls wait, and behind what.
test("scope: only reads wait, only behind threads.get and chat.messages.list, and only while one of them is out", async () => {
  const w = world();
  void w.call("threads.get", { threadId: "t" });
  void w.call("chat.post", { threadId: "t", body: "x" }); // a write
  void w.call("agents.list", {}, { signal: new AbortController().signal }); // a read with a signal is not shared and not held
  void w.call("stars.list", {}); // a plain read
  void w.call("threads.get", { threadId: "u" }); // the chat reads themselves never wait for each other
  await tick();
  assert.deepEqual(w.sent.map((s) => s.cap), ["threads.get", "chat.post", "agents.list", "threads.get"], "the write, the read with a signal and both thread reads went out; only the plain read is held");
  w.sent[0]!.done(); await tick();
  assert.equal(w.sent.length, 4, "one chat read is still out: the plain read keeps waiting");
  w.sent[3]!.done(); await tick();
  assert.deepEqual(w.sent.map((s) => s.cap).slice(4), ["stars.list"], "both answered: the held read goes");
  void w.call("stars.list", { n: 2 }); await tick();
  assert.equal(w.sent.length, 6, "with no chat read out, a read is not held at all");
});

// (c) the normal case: a chat that answers quickly holds nothing back for longer than it takes to answer.
test("a read on another screen goes out the moment the chat reads answer, not after the cap", async () => {
  const w = world();
  void w.call("threads.get", { threadId: "t" }); void w.call("chat.messages.list", { threadId: "t" });
  void w.call("agents.list", {});
  await tick();
  assert.equal(w.sent.length, 2);
  const t0 = Date.now();
  w.sent[0]!.done(); w.sent[1]!.done();
  while (w.sent.length < 3 && Date.now() - t0 < 300) await new Promise((r) => setTimeout(r, 1));
  assert.equal(w.sent.length, 3, "the held read went out");
  assert.ok(Date.now() - t0 < 60, `it went out ${Date.now() - t0} ms after the answer (the cap is 400 ms, a ceiling for a chat that never answers)`);
});

test("a chat read that fails also lets the held reads go", async () => {
  const sent: string[] = [];
  const fetchFn = ((url: string) => { const cap = String(url).replace(/^.*\/v1\//, "").replaceAll("/", "."); sent.push(cap); return cap === "threads.get" ? Promise.reject(new Error("offline")) : new Promise(() => undefined); }) as unknown as typeof fetch;
  const call = createCapCaller({ baseUrl: "http://x", token: () => "t", fetch: fetchFn, routes: async () => ROUTES });
  const failed = call("threads.get", { threadId: "t" }).catch((e: Error) => e.message);
  void call("agents.list", {});
  assert.equal(await failed, "offline");
  await tick();
  assert.deepEqual(sent, ["threads.get", "agents.list"]);
});

// (d) sharing never crosses arguments, sessions or Spaces.
test("two Spaces (two callers on two addresses) never share a read, even with the same token and arguments", async () => {
  const urls: string[] = [];
  const fetchFn = ((url: string) => { urls.push(String(url)); return new Promise(() => undefined); }) as unknown as typeof fetch;
  const mk = (baseUrl: string) => createCapCaller({ baseUrl, token: () => "same", fetch: fetchFn, routes: async () => ROUTES });
  void mk("http://space-a")("stars.list", {}); void mk("http://space-b")("stars.list", {});
  await tick();
  assert.deepEqual(urls.sort(), ["http://space-a/v1/stars/list", "http://space-b/v1/stars/list"]);
});

test("a write ends the sharing for reads asked for after it, and the old read still answers its own askers", async () => {
  const w = world();
  const before = w.call("stars.list", {}); await tick();
  void w.call("chat.post", { threadId: "t", body: "x" }); await tick();
  const after = w.call("stars.list", {}); await tick();
  assert.deepEqual(w.sent.map((s) => s.cap), ["stars.list", "chat.post", "stars.list"]);
  w.sent[0]!.done(); w.sent[2]!.done();
  assert.deepEqual(await Promise.all([before, after]), [{ cap: "stars.list" }, { cap: "stars.list" }]);
});

// (e) errors reach every sharer and are never kept.
test("a refused or failed read is delivered to every sharer, and the next ask is a new request", async () => {
  for (const status of [403, 500]) {
    const sent: (() => void)[] = [];
    const fetchFn = (() => new Promise((resolve) => { sent.push(() => resolve({ status, headers: { get: () => null }, json: async () => ({ error: { code: status === 403 ? "access.denied" : "internal.unexpected", message: "no", traceId: "x" } }) })); })) as unknown as typeof fetch;
    const call = createCapCaller({ baseUrl: "http://x", token: () => "t", fetch: fetchFn, routes: async () => ROUTES });
    const asks = [call("stars.list", {}), call("stars.list", {}), call("stars.list", {})];
    const settled = Promise.allSettled(asks);
    await tick();
    assert.equal(sent.length, 1, `${status}: one request for three askers`);
    sent[0]!();
    const out = await settled;
    assert.ok(out.every((o) => o.status === "rejected" && (o.reason as { status?: number }).status === status), `${status}: every asker got the error`);
    void call("stars.list", {}).catch(() => undefined); await tick();
    assert.equal(sent.length, 2, `${status}: the error was not kept; the next ask is a new request`);
    sent[1]!();
  }
  // a network failure (fetch rejects) is shared and not kept either
  let n = 0;
  const failing = (() => { n += 1; return Promise.reject(new Error("offline")); }) as unknown as typeof fetch;
  const c = createCapCaller({ baseUrl: "http://x", token: () => "t", fetch: failing, routes: async () => ROUTES });
  const two = await Promise.allSettled([c("stars.list", {}), c("stars.list", {})]);
  assert.ok(two.every((o) => o.status === "rejected"));
  assert.equal(n, 1, "two askers, one request");
  await c("stars.list", {}).catch(() => undefined);
  assert.equal(n, 2, "and a later ask goes out again");
});
