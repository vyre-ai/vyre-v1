// A person's own computer links to the Space with their session token. When that session ends, or the person is suspended or removed, the link closes at once (endSessions), not at the next
// recheck; another session's link and another person's stay.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createComputeStream } from "../src/routes/compute-stream.ts";

const TOKENS: Record<string, { person: string; device: string; sessionId: string }> = {
  vst_maya_mac: { person: "usr_maya", device: "dev_mac", sessionId: "ses_mac" },
  vst_maya_pc: { person: "usr_maya", device: "dev_pc", sessionId: "ses_pc" },
  vst_leo: { person: "usr_leo", device: "dev_leo", sessionId: "ses_leo" },
};

async function rig() {
  const stream = createComputeStream({
    poll: async () => null,
    device: async (t) => TOKENS[t] ?? null,
    open: async () => null, mayInput: async () => false, recheckMs: 600_000, secure: () => true,
  });
  const server = http.createServer((_q, r) => r.writeHead(404).end());
  server.on("upgrade", (req, socket, head) => stream.upgrade(req, socket, head));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const link = async (token: string) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/compute/stream`, { headers: { authorization: `Bearer ${token}` } } as never);
    const closed = new Promise<number>((r) => ws.addEventListener("close", (e) => r(e.code)));
    await new Promise<void>((r) => ws.addEventListener("message", () => r(), { once: true }));
    return { ws, closed, open: () => ws.readyState === WebSocket.OPEN };
  };
  return { stream, link, close: () => { stream.close(); server.closeAllConnections(); server.close(); } };
}

test("ending one session closes that computer's link at once; ending the person closes all of theirs; nobody else's", async (t) => {
  const r = await rig();
  t.after(r.close);
  const mac = await r.link("vst_maya_mac"), pc = await r.link("vst_maya_pc"), leo = await r.link("vst_leo");
  assert.equal(r.stream.endSessions({ sessionId: "ses_mac" }), 1);
  assert.equal(await mac.closed, 4003);
  assert.equal(pc.open(), true, "Maya's other computer stays linked");
  assert.equal(r.stream.endSessions({ person: "usr_maya" }), 1);
  assert.equal(await pc.closed, 4003);
  assert.equal(leo.open(), true, "Leo's computer stays linked");
});
