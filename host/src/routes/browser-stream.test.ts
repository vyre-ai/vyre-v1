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
    if (new URL(req.url ?? "/", "http://x").pathname !== "/stream") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "multipart/x-mixed-replace; boundary=vyreframe" });
    const t = setInterval(
      () => res.write("--vyreframe\r\ncontent-type: image/jpeg\r\ncontent-length: 4\r\n\r\nJPEG\r\n"),
      20,
    );
    res.once("close", () => clearInterval(t));
  });
  upstream.on("upgrade", (req, socket, head) => {
    const peer = acceptPeer(req, socket, head, 4096);
    if (!peer) return;
    const t = setInterval(() => peer.send(new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9])), 20);
    peer.onClose(() => clearInterval(t));
    peer.onMessage((d) => {
      const text = d.toString("utf8");
      upstreamInput.push(text);
      const seq = (JSON.parse(text) as { seq?: number }).seq ?? 0;
      peer.send(JSON.stringify({ t: "ack", seq }));
    });
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const up = (upstream.address() as AddressInfo).port;
  const tickets = new Map<string, BrowserOpened>();
  let holds = true;
  const relay = createBrowserStream({
    open: async (t, agent) => (agent === "agt_dex" ? (tickets.get(t) ?? null) : null),
    mayInput: async () => holds,
    now: Date.now,
  });
  const front = http.createServer((req, res) => {
    if (!relay.handle(req, res)) {
      res.writeHead(404).end();
    }
  });
  front.on("upgrade", (req, socket, head) => {
    if (relay.claims(req)) relay.upgrade(req, socket, head);
    else socket.destroy();
  });
  await new Promise<void>((r) => front.listen(0, "127.0.0.1", r));
  const port = (front.address() as AddressInfo).port;
  const issue = (t: string, input: boolean): string => {
    tickets.set(t, {
      url: `http://127.0.0.1:${up}/stream`,
      ws: `ws://127.0.0.1:${up}/ws`,
      personId: "usr_dana",
      input,
    });
    return t;
  };
  return {
    port,
    relay,
    issue,
    upstreamInput,
    setHolds(v: boolean) {
      holds = v;
    },
    close: async () => {
      front.closeAllConnections();
      upstream.closeAllConnections();
      front.close();
      upstream.close();
    },
  };
}

const open = (
  port: number,
  path: string,
): Promise<{
  ws: WebSocket;
  frames: number;
  msgs: Array<{ t: string; seq?: number; reason?: string }>;
  failed: boolean;
}> =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    ws.binaryType = "arraybuffer";
    const out = { ws, frames: 0, msgs: [] as Array<{ t: string; seq?: number; reason?: string }>, failed: false };
    ws.addEventListener("message", (ev: MessageEvent) => {
      if (typeof ev.data === "string") out.msgs.push(JSON.parse(ev.data));
      else out.frames += 1;
    });
    ws.addEventListener("open", () => resolve(out));
    ws.addEventListener("error", () => {
      out.failed = true;
      resolve(out);
    });
  });
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ask = async (
  v: { ws: WebSocket; msgs: Array<{ t: string; seq?: number; reason?: string }> },
  m: Record<string, unknown>,
) => {
  const seq = Math.floor(Math.random() * 1e9);
  v.ws.send(JSON.stringify({ ...m, seq }));
  for (let i = 0; i < 60; i++) {
    const got = v.msgs.find((x) => x.seq === seq);
    if (got) return got;
    await sleep(10);
  }
  throw new Error("no answer");
};

test("MJPEG: a good ticket relays the browser's frames; no ticket, a wrong one or another agent's gets a plain refusal", async (t) => {
  const w = await world();
  t.after(w.close);
  assert.equal((await fetch(`http://127.0.0.1:${w.port}/browsers/agt_dex/stream`)).status, 403);
  assert.equal((await fetch(`http://127.0.0.1:${w.port}/browsers/agt_dex/stream?ticket=nope`)).status, 403);
  w.issue("good", false);
  assert.equal(
    (await fetch(`http://127.0.0.1:${w.port}/browsers/agt_other/stream?ticket=good`)).status,
    403,
    "a ticket is for one agent's browser",
  );
  assert.equal(
    (await fetch(`http://127.0.0.1:${w.port}/browsers/agt_dex/stream?ticket=good`, { method: "POST" })).status,
    405,
  );
  const res = await fetch(`http://127.0.0.1:${w.port}/browsers/agt_dex/stream?ticket=good`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /multipart\/x-mixed-replace/);
  const reader = res.body!.getReader();
  let text = "";
  const dec = new TextDecoder();
  for (let i = 0; i < 6 && !/JPEG[\s\S]*--vyreframe[\s\S]*JPEG/.test(text); i++)
    text += dec.decode((await reader.read()).value ?? new Uint8Array());
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

// Second look D (12 Nov): the holder's own open view keeps a takeover going, so a view whose other end went away must close, or a closed laptop would hold the agent's browser for good.
test("a WebSocket view that answers no ping is closed, and so is its view in the browser service; one that answers stays", async (t) => {
  const upstreamClosed: number[] = [];
  const upstream = http.createServer();
  upstream.on("upgrade", (req, socket, head) => {
    const peer = acceptPeer(req, socket, head, 4096);
    if (peer) peer.onClose(() => upstreamClosed.push(Date.now()));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const up = (upstream.address() as AddressInfo).port;
  const relay = createBrowserStream({
    open: async () => ({
      url: `http://127.0.0.1:${up}/stream`,
      ws: `ws://127.0.0.1:${up}/ws`,
      personId: "usr_dana",
      input: true,
    }),
    mayInput: async () => true,
    pingMs: 50,
    deadMs: 300,
  });
  const front = http.createServer((req, res) => {
    if (!relay.handle(req, res)) res.writeHead(404).end();
  });
  front.on("upgrade", (req, socket, head) => relay.upgrade(req, socket, head));
  await new Promise<void>((r) => front.listen(0, "127.0.0.1", r));
  const port = (front.address() as AddressInfo).port;
  t.after(() => {
    front.closeAllConnections();
    upstream.closeAllConnections();
    front.close();
    upstream.close();
  });
  // a viewer that answers pings (a browser does by itself)
  const good = new WebSocket(`ws://127.0.0.1:${port}/browsers/agt_dex/ws?ticket=x`);
  await new Promise<void>((r) => good.addEventListener("open", () => r()));
  // a viewer that went away without closing: it did the handshake and then never answers anything
  const net = await import("node:net");
  const dead = net.connect(port, "127.0.0.1");
  await new Promise<void>((r) => dead.once("connect", () => r()));
  dead.write(
    `GET /browsers/agt_dex/ws?ticket=y HTTP/1.1\r\nhost: x\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==\r\nsec-websocket-version: 13\r\n\r\n`,
  );
  dead.on("data", () => undefined);
  let deadClosed = false;
  dead.on("close", () => {
    deadClosed = true;
  });
  for (let i = 0; i < 40 && !deadClosed; i++) await sleep(50);
  assert.equal(deadClosed, true, "the view that answered nothing was closed");
  assert.equal(upstreamClosed.length, 1, "and its view in the browser service with it");
  assert.equal(good.readyState, 1, "the live one stays open");
  good.close();
});

// Fourth look (12 Nov): on a page that is not changing no frame comes, so the dead MJPEG check that ran only on frames never ran, and a closed laptop's view stayed open for good.
test("an MJPEG view of a still page whose viewer stopped taking anything is closed by the timer, and so is its view in the browser service", async (t) => {
  let upstreamClosed = 0;
  const frame = Buffer.alloc(512 * 1024, 0x41);
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "multipart/x-mixed-replace; boundary=vyreframe" });
    // one frame, then a still page: nothing more, ever
    res.write(
      Buffer.concat([
        Buffer.from(`--vyreframe\r\ncontent-type: image/jpeg\r\ncontent-length: ${frame.length}\r\n\r\n`),
        frame,
        Buffer.from("\r\n--vyreframe\r\n"),
      ]),
    );
    res.once("close", () => {
      upstreamClosed += 1;
    });
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const up = (upstream.address() as AddressInfo).port;
  const relay = createBrowserStream({
    open: async () => ({
      url: `http://127.0.0.1:${up}/stream`,
      ws: `ws://127.0.0.1:${up}/ws`,
      personId: "usr_dana",
      input: true,
    }),
    mayInput: async () => true,
    pingMs: 30,
    deadMs: 500,
  });
  const front = http.createServer((req, res) => {
    if (!relay.handle(req, res)) res.writeHead(404).end();
  });
  await new Promise<void>((r) => front.listen(0, "127.0.0.1", r));
  const port = (front.address() as AddressInfo).port;
  t.after(() => {
    front.closeAllConnections();
    upstream.closeAllConnections();
    front.close();
    upstream.close();
  });
  const net = await import("node:net");
  const viewer = net.connect(port, "127.0.0.1");
  await new Promise<void>((r) => viewer.once("connect", () => r()));
  viewer.write("GET /browsers/agt_dex/stream?ticket=x HTTP/1.1\r\nhost: x\r\n\r\n");
  // it reads the first bytes, then takes nothing more (a laptop whose lid closed)
  await new Promise<void>((r) => viewer.once("data", () => r()));
  viewer.pause();
  let closed = false;
  viewer.on("close", () => {
    closed = true;
  });
  for (let i = 0; i < 200 && (relay.views() > 0 || upstreamClosed === 0); i++) await sleep(50);
  assert.equal(relay.views(), 0, "the view was ended by the timer, though no frame came after the first");
  assert.equal(upstreamClosed, 1, "and its view in the browser service was closed");
  viewer.destroy();
  void closed;
});

test("a person who can no longer watch (signed out, suspended, removed): their open views end at once, the socket and the MJPEG stream", async (t) => {
  const w = await world();
  t.after(w.close);
  w.issue("sock", false);
  const v = await open(w.port, "/browsers/agt_dex/ws?ticket=sock");
  for (let i = 0; i < 40 && v.frames === 0; i++) await sleep(25);
  assert.ok(v.frames > 0, "the view is live");
  w.issue("mjpeg", false);
  const res = await fetch(`http://127.0.0.1:${w.port}/browsers/agt_dex/stream?ticket=mjpeg`);
  assert.equal(res.status, 200);
  const reader = res.body!.getReader();
  await reader.read();
  const closed = new Promise<number>((r) => v.ws.addEventListener("close", (e) => r(e.code)));
  assert.equal(w.relay.endPerson("usr_other"), 0, "someone else's end touches nothing");
  assert.equal(w.relay.endPerson("usr_dana"), 2, "both of Dana's views end");
  assert.equal(await closed, 1008);
  let ended = false;
  for (let i = 0; i < 40 && !ended; i++) ended = (await reader.read()).done;
  assert.equal(ended, true, "the MJPEG stream ends");
});
