// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import { createBridge, toBoxRequest, toResponse } from "./bridge.js";
import { makeResponse, Pipe } from "../response.js";

/** @param {number} status @param {Record<string,string>} headers @param {string[]} chunks */
function boxAnswer(status, headers, chunks) {
  const p = new Pipe();
  for (const c of chunks) p.push(new TextEncoder().encode(c));
  p.end();
  return makeResponse(status, headers, p);
}

test("a request reaches the box with its path, query, method, headers and body, minus the phone's own hop", async () => {
  /** @type {any[]} */ const seen = [];
  const bridge = createBridge({ label: () => "Home laptop", box: async () => ({ fetch: async (path, init) => { seen.push({ path, init }); return boxAnswer(201, { "content-type": "application/json", "set-cookie": "a=b", "content-length": "9" }, ['{"a":', "1}"]); } }) });
  const res = await bridge.handle(new Request("https://alex.vyre.run/v1/things?x=1&y=2", { method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json", "accept-encoding": "gzip", host: "alex.vyre.run" }, body: '{"k":1}' }));
  assert.ok(res);
  assert.equal(res.status, 201);
  assert.equal(await res.text(), '{"a":1}');
  assert.equal(res.headers.get("content-type"), "application/json");
  assert.equal(res.headers.get("set-cookie"), null, "a service worker response cannot set cookies, and the box's must not leak");
  assert.equal(seen[0].path, "/v1/things?x=1&y=2");
  assert.equal(seen[0].init.method, "POST");
  assert.equal(seen[0].init.headers.authorization, "Bearer t");
  assert.equal(seen[0].init.headers["accept-encoding"], undefined);
  assert.equal(new TextDecoder().decode(seen[0].init.body), '{"k":1}');
});

test("a phone with no pin is not ours: the network answers", async () => {
  const bridge = createBridge({ label: () => "x", box: async () => null });
  assert.equal(await bridge.handle(new Request("https://alex.vyre.run/")), null);
});

test("a box that does not answer is 'asleep': a page for a navigation, JSON for anything else", async () => {
  const bridge = createBridge({ label: () => "Home <laptop>", waitMs: 20, box: async () => ({ fetch: (_p, init) => new Promise((_r, rej) => init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))) }) });
  const nav = await bridge.handle(new Request("https://alex.vyre.run/", { headers: { accept: "text/html" } }));
  assert.equal(nav?.status, 503);
  const html = await nav?.text();
  assert.match(html || "", /Home &lt;laptop&gt; is asleep/);
  const api = await bridge.handle(new Request("https://alex.vyre.run/v1/x", { headers: { accept: "application/json" } }));
  assert.equal(api?.status, 503);
  assert.deepEqual(await api?.json(), { error: "Home <laptop> is asleep" });
});

test("a removed phone is told so, not told the box sleeps", async () => {
  const bridge = createBridge({ label: () => "Home laptop", box: async () => ({ state: "relay_removed", fetch: async () => { throw Object.assign(new Error("device removed"), { code: "relay_removed" }); } }) });
  const res = await bridge.handle(new Request("https://alex.vyre.run/", { headers: { accept: "text/html" } }));
  assert.equal(res?.status, 403);
  assert.match((await res?.text()) || "", /was removed/);
});

test("a stream keeps flowing chunk by chunk and a cancelled read stops the box's stream", async () => {
  let returned = false;
  const body = { [Symbol.asyncIterator]() { let n = 0; return { async next() { return n++ < 3 ? { value: new TextEncoder().encode(`data: ${n}\n\n`), done: false } : await new Promise(() => {}); }, async return() { returned = true; return { done: true, value: undefined }; } }; } };
  const res = toResponse({ status: 200, headers: [["content-type", "text/event-stream"]], body });
  const reader = /** @type {ReadableStream} */ (res.body).getReader();
  const got = [];
  for (let i = 0; i < 3; i++) got.push(new TextDecoder().decode((await reader.read()).value));
  assert.deepEqual(got, ["data: 1\n\n", "data: 2\n\n", "data: 3\n\n"]);
  await reader.cancel();
  assert.equal(returned, true);
});

test("a body-less status stays body-less", async () => {
  assert.equal(toResponse({ status: 204, headers: [], body: (async function* () {})() }).status, 204);
  const { init } = await toBoxRequest(new Request("https://alex.vyre.run/a", { method: "GET" }));
  assert.equal(init.body, null);
});
