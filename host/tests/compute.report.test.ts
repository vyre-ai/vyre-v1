// A computer's report frame reaches the host with who sent it: a person's own computer by its device, a node that joined by its server id. A frame from a socket that has not been admitted never arrives.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createComputeStream } from "../src/routes/compute-stream.ts";
import type { DeviceLink } from "../src/routes/compute-stream.ts";
import { platformSocket } from "../src/compute/node.ts";

const wait = async (ok: () => boolean, ms = 2000): Promise<void> => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 10)); };

test("report frames reach the host with the device or the server id they came from", async () => {
  const got: Array<{ nodeId: string; serverId?: string; device?: DeviceLink; report: unknown }> = [];
  const stream = createComputeStream({
    poll: async (c) => (c === "vcc_node" ? { serverId: "srv_box" } : null),
    device: async (t) => (t === "vst_maya" ? { person: "usr_maya", device: "dev_ab12", name: "Maya's MacBook" } : null),
    open: async () => null, mayInput: async () => false,
    report: (from, report) => { got.push({ ...from, report }); },
  });
  const server = http.createServer((_q, r) => { r.statusCode = 404; r.end(); });
  server.on("upgrade", (req, socket, head) => { if (stream.claims(req)) stream.upgrade(req, socket, head); else socket.destroy(); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/compute/stream`;
  try {
    const dial = async (token: string): Promise<ReturnType<typeof platformSocket>> => {
      const s = platformSocket(url, { authorization: `Bearer ${token}` });
      await new Promise<void>((r) => s.onOpen(r));
      return s;
    };
    const mine = await dial("vst_maya"), node = await dial("vcc_node");
    mine.send(JSON.stringify({ t: "hello", engines: ["claude_code"], name: "Maya's MacBook" }));
    mine.send(JSON.stringify({ t: "report", report: { n: 1 } }));
    node.send(JSON.stringify({ t: "report", report: { n: 2 } }));
    await wait(() => got.length === 2);
    const byNode = Object.fromEntries(got.map((g) => [g.nodeId, g]));
    assert.equal(byNode["device:dev_ab12"]?.device?.person, "usr_maya");
    assert.equal(byNode["device:dev_ab12"]?.serverId, undefined);
    assert.deepEqual(byNode["device:dev_ab12"]?.report, { n: 1 });
    assert.equal(byNode["srv_box"]?.serverId, "srv_box");
    assert.equal(byNode["srv_box"]?.device, undefined);
    // a socket that was not admitted never gets as far as a frame
    const bad = platformSocket(url, { authorization: "Bearer nobody" });
    let opened = false; bad.onOpen(() => { opened = true; });
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(opened, false);
    mine.close(); node.close(); bad.close();
  } finally { stream.close(); server.close(); }
});
