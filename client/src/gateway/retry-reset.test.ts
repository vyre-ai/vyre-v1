// A call that carries an idempotency key is sent once more when the connection was reset before an answer came (a reused connection the server closed as the call went out); a call without a key never is.
import test from "node:test";
import assert from "node:assert/strict";
import { createCapCaller, isConnectionReset } from "./index.ts";

const routes = async () => [
  { method: "POST", path: "/v1/records/update", cap: "records.update", v: 1, idempotency: "none", effects: "write" },
  { method: "POST", path: "/v1/records/touch", cap: "records.touch", v: 1, idempotency: "natural", effects: "write" },
  { method: "POST", path: "/v1/records/create", cap: "records.create", v: 1, idempotency: "key", effects: "write" },
  { method: "GET", path: "/v1/records/get", cap: "records.get", v: 1, idempotency: "none", effects: "read" },
];
const reset = (): Error => Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
const ok = (): Response =>
  new Response(JSON.stringify({ data: { done: true } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function caller(failures: Error[]) {
  const sent: { url: string; body: string }[] = [];
  const call = createCapCaller({
    baseUrl: "https://a.example",
    token: () => "tok",
    routes: routes as never,
    fetch: (async (url: string, init: { body?: string }) => {
      sent.push({ url: String(url), body: String(init.body ?? "") });
      const f = failures.shift();
      if (f) throw f;
      return ok();
    }) as unknown as typeof fetch,
  });
  return { call, sent };
}

test("a call to a route that takes a key is sent once more after a reset connection, with the same key", async () => {
  const { call, sent } = caller([reset()]);
  const out = await call("records.create", { type: "t", idempotencyKey: "k-1", fields: {} });
  assert.deepEqual(out, { done: true });
  assert.equal(sent.length, 2);
  assert.equal(sent[0]!.body, sent[1]!.body, "the repeat is the same call: the same body and key");
});

test("a key minted for the call is the same on the repeat", async () => {
  const { call, sent } = caller([reset()]);
  await call("records.create", { type: "t", fields: {} });
  assert.equal(sent.length, 2);
  assert.match(sent[0]!.body, /"idempotencyKey":"[^"]+"/);
  assert.equal(sent[0]!.body, sent[1]!.body);
});

test("a route that does not take a key is never repeated, with or without a key in the call; a second reset is not hidden", async () => {
  const none = caller([reset()]);
  await assert.rejects(
    none.call("records.update", { type: "t", patch: {} }),
    (e: { code?: string }) => e.code === "ECONNRESET",
  );
  assert.equal(none.sent.length, 1, "no key: sent once");
  const body = caller([reset()]);
  await assert.rejects(body.call("records.update", { type: "t", idempotencyKey: "k-0", patch: {} }));
  assert.equal(body.sent.length, 1, "a key in the body of a route that never reads it: sent once");
  const header = caller([reset()]);
  await assert.rejects(header.call("records.update", { type: "t", patch: {} }, { idempotencyKey: "k-h" }));
  assert.equal(header.sent.length, 1, "a session key on a route that never reads it: sent once");
  const natural = caller([reset()]);
  await assert.rejects(natural.call("records.touch", { type: "t", idempotencyKey: "k-n" }));
  assert.equal(natural.sent.length, 1, "a natural route is not repeated either");
  const twice = caller([reset(), reset()]);
  await assert.rejects(
    twice.call("records.create", { type: "t", idempotencyKey: "k-2", fields: {} }),
    (e: { code?: string }) => e.code === "ECONNRESET",
  );
  assert.equal(twice.sent.length, 2, "one repeat, no more");
});

test("a read is not repeated, and an error that is not a reset is not either", async () => {
  const read = caller([reset()]);
  await assert.rejects(read.call("records.get", { type: "t" }));
  assert.equal(read.sent.length, 1);
  const other = caller([new Error("boom")]);
  await assert.rejects(other.call("records.create", { type: "t", idempotencyKey: "k-3", fields: {} }));
  assert.equal(other.sent.length, 1);
});

test("what counts as a reset: the code on the error or its cause, or the words of a hang-up", () => {
  assert.ok(isConnectionReset(reset()));
  assert.ok(isConnectionReset(new Error("socket hang up")));
  assert.ok(isConnectionReset(Object.assign(new TypeError("fetch failed"), { cause: reset() })));
  assert.ok(!isConnectionReset(new TypeError("Failed to fetch")));
  assert.ok(!isConnectionReset(null));
});
