// A live message the box sends that is too big for one relay frame (over 1 MiB with its framing) resets the stream with the reason "too big"; it never ends it as if the server had closed cleanly (a clean end
// made the page reconnect from the same cursor to the same message for ever, 17 Nov 2026), and the daemon stays up (a client WebSocket closed with 1009 throws).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { acceptPeer } from "../src/ws.ts";
import type { Peer } from "../src/ws.ts";
import { serveStream } from "../src/seams/relay.ts";
import type { Channel, Stream } from "../src/seams/relay.ts";

test("a message over the relay frame limit resets the stream as too big; one under it goes through", async () => {
  let peer: Peer | null = null;
  const server = http.createServer();
  server.on("upgrade", (req, socket: Duplex, head) => {
    peer = acceptPeer(req, socket, head, 8 << 20);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const calls: string[] = [];
  const sizes: number[] = [];
  const s: Stream = { id: 7, head: { ws: "/x", headers: {} }, body: [], bodyBytes: 0, ended: false };
  const ch = {
    streams: new Map([[7, s]]),
    respond: () => calls.push("respond"),
    frame: (_t: number, _id: number, p: Uint8Array) => {
      calls.push("frame");
      sizes.push(p.length);
    },
    end: () => calls.push("end"),
    reset: (_s: Stream, why: string) => {
      calls.push(`reset:${why}`);
      ch.streams.delete(7);
    },
  } as unknown as Channel;
  const crash: Error[] = [];
  process.once("uncaughtException", (e) => crash.push(e));
  try {
    serveStream(s, ch, port);
    for (let i = 0; i < 100 && !calls.includes("respond"); i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(calls.includes("respond"), "the stream opened");
    peer!.send("a".repeat(100_000));
    for (let i = 0; i < 100 && !sizes.length; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(sizes.length, 1, "a message under the limit crosses");
    peer!.send("b".repeat((1 << 20) + 10));
    for (let i = 0; i < 100 && !calls.some((c) => c.startsWith("reset")); i++)
      await new Promise((r) => setTimeout(r, 20));
    assert.ok(calls.includes("reset:too big"), `reset as too big: ${calls}`);
    assert.ok(!calls.includes("end"), "and not ended as a clean close");
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(crash, [], "the process did not throw");
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
