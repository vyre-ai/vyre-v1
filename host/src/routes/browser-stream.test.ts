// The relay of an agent browser's live view (browser-stream.ts): a viewer without a good ticket gets nothing, a watch ticket gets frames and never input, a take-over ticket gets input only while its person
// still holds the controls, and the browser service's own address never reaches the viewer. A fake browser service (MJPEG and a WebSocket, with the same wire as images/space-browser) sits behind it.
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { acceptPeer } from "../ws.ts";
import { createBrowserStream } from "./browser-stream.ts";
import type { BrowserOpened } from "./browser-stream.ts";

async function world() {
  const upstreamInput: string[] = [];
  const upstream = http.createServer((req, res) => {
    if (new URL(req.url ?? "/", "http://x").pathname !== "/stream") { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": "multipart/x-mixed-replace; boundary=vyreframe" });
    const t = setInterval(() => res.write("--vyreframe\r\ncontent-type: image/jpeg\r\ncontent-length: 4\r\n\r\nJPEG\r\n"), 20);
    res.once("close", () => clearInterval(t));
  });
  upstream.on("upgrade", (req, socket, head) => {
    const peer = acceptPeer(req, socket, head, 4096);
    if (!peer) return;
    const t = setInterval(() => peer.send(new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9])), 20);
    peer.onClose(() => clearInterval(t));
    peer.onMessage((d) => { const text = d.toString("utf8"); upstreamInput.push(text); const seq = (JSON.parse(text) as { seq?: number }).seq ?? 0; peer.send(JSON.stringify({ t: "ack", seq })); });
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const up = (upstream.address() as AddressInfo).port;
  const tickets = new Map<string, BrowserOpened>();
  let holds = true;
  const relay = createBrowserStream({ open: async (t, agent) => (agent === "agt_dex" ? tickets.get(t) ?? null : null), mayInput: async () => holds, now: Date.now });
  const front = http.createServer((req, res) => { if (!relay.handle(req, res)) { res.writeHead(404).end(); } });
  front.on("upgrade", (req, socket, head) => { if (relay.claims(req)) relay.upgrade(req, socket, head); else socket.destroy(); });
  await new Promise<void>((r) => front.listen(0, "127.0.0.1", r));
  const port = (front.address() as AddressInfo).port;
  const issue = (t: string, input: boolean): string => { tickets.set(t, { url: `http://127.0.0.1:${up}/stream`, ws: `ws://127.0.0.1:${up}/ws`, personId: "usr_dana", input }); return t; };
  return { port, relay, issue, upstreamInput, setHolds(v: boolean) { holds = v; }, close: async () => { front.closeAllConnections(); upstream.closeAllConnections(); front.close(); upstream.close(); } };
}

const open = (port: number, path: string): Promise<{ ws: WebSocket; frames: number; msgs: Array<{ t: string; seq?: number; reason?: string }>; failed: boolean }> => new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  ws.binaryType = "arraybuffer";
  const out = { ws, frames: 0, msgs: [] as Array<{ t: string; seq?: number; reason?: string }>, failed: false };
  ws.addEventListener("message", (ev: MessageEvent) => { if (typeof ev.data === "string") out.msgs.push(JSON.parse(ev.data)); else out.frames += 1; });
  ws.addEventListener("open", () => resolve(out));
  ws.addEventListener("error", () => { out.failed = true; resolve(out); });
});
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ask = async (v: { ws: WebSocket; msgs: Array<{ t: string; seq?: number; reason?: string }> }, m: Record<string, unknown>) => {
  const seq = Math.floor(Math.random() * 1e9);
  v.ws.send(JSON.stringify({ ...m, seq }));
  for (let i = 0; i < 60; i++) { const got = v.msgs.find((x) => x.seq === seq); if (got) return got; await sleep(10); }
  throw new Error("no answer");
};

test("MJPEG: a good ticket relays the browser's frames; no ticket, a wrong one or another agent's gets a plain refusal", async (t) => {
  const w = await world();
  t.after(w.close);
  assert.equal((await fetch(`http://127.0.0.1:${w.port}/browsers/agt_dex/stream`)).status, 403);
  assert.equal((await fetch(`http://127.0.0.1:${w.port}/browsers/agt_dex/stream?ticket=nope`)).status, 403);
  w.issue("good", false);
  assert.equal((await fetch(`http://127.0.0.1:${w.port}/browsers/agt_other/stream?ticket=good`)).status, 403, "a ticket is for one agent's browser");
  assert.equal((await fetch(`http://127.0.0.1:${w.port}/browsers/agt_dex/stream?ticket=good`, { method: "POST" })).status, 405);
  const res = await fetch(`http://127.0.0.1:${w.port}/browsers/agt_dex/stream?ticket=good`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /multipart\/x-mixed-replace/);
  const reader = res.body!.getReader();
  let text = "";
  const dec = new TextDecoder();
  for (let i = 0; i < 6 && !/JPEG[\s\S]*--vyreframe[\s\S]*JPEG/.test(text); i++) text += dec.decode((await reader.read()).value ?? new Uint8Array());
  assert.match(text, /JPEG/);
  assert.ok(!text.includes("127.0.0.1"), "the browser service's address does not reach the viewer");
  await reader.cancel();
  for (let i = 0; i < 40 && w.relay.views() > 0; i++) await sleep(25);
  assert.equal(w.relay.views(), 0, "a viewer that left is not counted");
});

test("WebSocket: frames come down; a watch ticket never sends input; a take-over ticket does, until its person gives the controls back", async (t) => {
  const w = await world();
  t.after(w.close);
  assert.equal((await open(w.port, "/browsers/agt_dex/ws?ticket=nope")).failed, true, "no good ticket, no socket");
  const watch = await open(w.port, `/browsers/agt_dex/ws?ticket=${w.issue("watch", false)}`);
  for (let i = 0; i < 40 && watch.frames < 3; i++) await sleep(20);
  assert.ok(watch.frames >= 3, "frames");
  assert.equal((await ask(watch, { t: "ping" })).t, "pong");
  assert.equal((await ask(watch, { t: "move", x: 5, y: 5 })).t, "refused", "a watch ticket never gets input");
  assert.equal((await ask(watch, { t: "nonsense" })).t, "refused");
  assert.deepEqual(w.upstreamInput, [], "nothing reached the browser");
  watch.ws.close();

  const take = await open(w.port, `/browsers/agt_dex/ws?ticket=${w.issue("take", true)}`);
  assert.equal((await ask(take, { t: "move", x: 9, y: 9 })).t, "ack");
  assert.equal(w.upstreamInput.length, 1);
  assert.equal((JSON.parse(w.upstreamInput[0]!) as { t: string }).t, "move");
  w.setHolds(false);
  await sleep(600);
  assert.equal((await ask(take, { t: "move", x: 1, y: 1 })).t, "refused", "a give-back stops it at once");
  assert.equal(w.upstreamInput.length, 1);
  take.ws.close();
});
