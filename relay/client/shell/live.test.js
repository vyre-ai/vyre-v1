// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createLive, PAGE_STREAMS } from "./live.js";
import { withShim } from "./bridge.js";
import { SHIM_SOURCE } from "./wsshim.js";

/** A relay socket as Connection.socket gives it. */
function fakeSocket() {
  /** @type {any} */
  const s = { sent: [], closed: null, onopen: null, onmessage: null, onclose: null, onerror: null, send(/** @type {unknown} */ d) { this.sent.push(d); }, close(/** @type {number} */ c) { this.closed = c; } };
  return s;
}
function page(id = "c1") {
  /** @type {any[]} */ const got = [];
  return { id, got, postMessage: (/** @type {any} */ m) => got.push(m.vyreWs) };
}

test("a page's live socket opens on the channel, carries text and bytes both ways, and closes", () => {
  const sockets = /** @type {any[]} */ ([]); const paths = /** @type {string[]} */ ([]);
  const live = createLive({ conn: () => ({ socket: p => { paths.push(p); const s = fakeSocket(); sockets.push(s); return s; } }) });
  const p = page();
  live.message(p, { vyreWs: { t: "open", id: 1, url: "wss://alex.vyre.run/sync/v1/ws?token=abc" } });
  assert.deepEqual(paths, ["/sync/v1/ws?token=abc"], "the worker keeps only the path and query");
  sockets[0].onopen();
  sockets[0].onmessage({ data: "hello" });
  sockets[0].onmessage({ data: new Uint8Array([1, 2, 3]).buffer });
  live.message(p, { vyreWs: { t: "send", id: 1, text: "ack" } });
  live.message(p, { vyreWs: { t: "send", id: 1, b64: Buffer.from([9, 8]).toString("base64") } });
  assert.deepEqual(p.got.map(m => m.t), ["open", "message", "message"]);
  assert.equal(p.got[1].text, "hello");
  assert.equal(p.got[2].b64, Buffer.from([1, 2, 3]).toString("base64"));
  assert.equal(sockets[0].sent[0], "ack");
  assert.deepEqual([...sockets[0].sent[1]], [9, 8]);
  live.message(p, { vyreWs: { t: "close", id: 1, code: 1000 } });
  assert.equal(sockets[0].closed, 1000);
});

test("only the listed streams open, at most four at a time, and no connection is a close the page sees", () => {
  const live = createLive({ conn: () => ({ socket: () => fakeSocket() }) });
  const p = page();
  live.message(p, { vyreWs: { t: "open", id: 1, url: "wss://alex.vyre.run/v1/secrets" } });
  assert.deepEqual([p.got[0].t, p.got[0].code], ["close", 1008]);
  for (let i = 2; i <= 5; i++) live.message(p, { vyreWs: { t: "open", id: i, url: "wss://alex.vyre.run/sync/v1/ws?token=t" } });
  live.message(p, { vyreWs: { t: "open", id: 6, url: "wss://alex.vyre.run/sync/v1/ws?token=t" } });
  assert.equal(p.got.at(-1).code, 1013);
  const none = createLive({ conn: () => null });
  const q = page("c2");
  none.message(q, { vyreWs: { t: "open", id: 1, url: "wss://alex.vyre.run/sync/v1/ws" } });
  assert.deepEqual([q.got[0].t, q.got[0].code], ["close", 1006]);
  assert.ok(PAGE_STREAMS.some(re => re.test("/sync/v1/ws?token=x")) && !PAGE_STREAMS.some(re => re.test("/sync/v1/ws/other")));
});

test("a page that is gone has its sockets closed", () => {
  const sockets = /** @type {any[]} */ ([]);
  const live = createLive({ conn: () => ({ socket: () => { const s = fakeSocket(); sockets.push(s); return s; } }) });
  live.message(page("a"), { vyreWs: { t: "open", id: 1, url: "/sync/v1/ws" } });
  live.message(page("b"), { vyreWs: { t: "open", id: 1, url: "/sync/v1/ws" } });
  live.keep(["b"]);
  assert.equal(sockets[0].closed, 1001);
  assert.equal(sockets[1].closed, null);
  assert.equal(live.pages, 1);
});

test("the HTML the box sends gets the shim as its first script; nothing else is touched", async () => {
  const html = (/** @type {string} */ body) => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "content-length": String(body.length) } });
  const a = await withShim(html("<!doctype html><html><head><title>x</title></head><body></body></html>"));
  assert.match(await a.text(), /^<!doctype html><html><head><script src="\/__vyre-ws\.js"><\/script><title>/);
  assert.equal(a.headers.get("content-length"), null);
  assert.match(await (await withShim(html("<!doctype html><p>hi"))).text(), /^<!doctype html><script src="\/__vyre-ws\.js"><\/script><p>hi/);
  assert.equal(await (await withShim(html("<p>no head</p>"))).text(), '<script src="/__vyre-ws.js"></script><p>no head</p>');
  const json = new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  assert.equal(await (await withShim(json)).text(), "{}");
  assert.equal((await withShim(new Response("<head>", { status: 404, headers: { "content-type": "text/html" } }))).status, 404);
});

test("the page shim takes the live socket and the screen stream through the worker and leaves every other WebSocket the browser's own", () => {
  const posted = /** @type {any[]} */ ([]);
  /** @type {any} */ let listener = null;
  class Native { /** @param {string} url */ constructor(url) { this.url = url; this.native = true; } }
  const sandbox = /** @type {any} */ ({
    navigator: { serviceWorker: { controller: { postMessage: (/** @type {any} */ m) => posted.push(m) }, addEventListener: (/** @type {string} */ _t, /** @type {any} */ f) => { listener = f; } } },
    location: { href: "https://alex.vyre.run/home", protocol: "https:", host: "alex.vyre.run" },
    URL, Uint8Array, ArrayBuffer, btoa, atob, String, Object,
  });
  sandbox.window = sandbox; sandbox.WebSocket = Native;
  vm.runInNewContext(SHIM_SOURCE, sandbox);
  const ws = new sandbox.WebSocket("wss://alex.vyre.run/sync/v1/ws?token=t");
  assert.equal(ws.native, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(posted[0])), { vyreWs: { t: "open", id: 1, url: "wss://alex.vyre.run/sync/v1/ws?token=t" } });
  /** @type {string[]} */ const events = [];
  ws.onopen = () => events.push("open"); ws.onmessage = (/** @type {any} */ e) => events.push(`msg:${e.data}`); ws.onclose = (/** @type {any} */ e) => events.push(`close:${e.code}`);
  listener({ data: { vyreWs: { t: "open", id: 1 } } });
  listener({ data: { vyreWs: { t: "message", id: 1, text: "tick" } } });
  ws.send("ack");
  assert.deepEqual(JSON.parse(JSON.stringify(posted[1])), { vyreWs: { t: "send", id: 1, text: "ack" } });
  listener({ data: { vyreWs: { t: "close", id: 1, code: 1000, wasClean: true } } });
  assert.deepEqual(events, ["open", "msg:tick", "close:1000"]);
  assert.equal(new sandbox.WebSocket("wss://other.example/socket").native, true, "another host is the browser's own");
  assert.equal(new sandbox.WebSocket("wss://alex.vyre.run/other").native, true, "a path the worker does not allow is the browser's own");
  sandbox.navigator.serviceWorker.controller = null;
  assert.equal(new sandbox.WebSocket("wss://alex.vyre.run/sync/v1/ws").native, true, "no worker yet: the browser's own, and the app polls");
});
