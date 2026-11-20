// r40: the servers inside the agent computer and the Space browser (stream, view, start page) get the same malformed request lines as the daemon: each answers 400 or closes, and is still serving afterwards.
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { startStreamServer } from "../../../images/agent-computer/agentd/stream.ts";
import { startViewServer } from "../../../images/space-browser/browserd/view.ts";
import { startStartServer } from "../../../images/space-browser/browserd/start.ts";

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });

const rawSend = (port: number, bytes: string): Promise<string> =>
  new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    let t = "";
    const done = (): void => {
      s.destroy();
      resolve(t.length ? (t.split("\r\n")[0] ?? "") : "closed");
    };
    s.setTimeout(3000, done);
    s.on("connect", () => s.write(bytes));
    s.on("data", (c) => {
      t += c.toString("latin1");
      if (t.includes("\r\n\r\n")) done();
    });
    s.on("error", done);
    s.on("close", done);
  });

const targets = ["//", "//[", "http://[::1", "%zz", "*", "/%zz", "//evil.test/stream", "/\u0000"];
const ws =
  "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n";

async function fuzz(port: number, alive: () => Promise<number>): Promise<void> {
  for (const t of targets) {
    for (const extra of ["", ws]) {
      const r = await rawSend(port, `GET ${t} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n${extra}\r\n`);
      assert.ok(r === "closed" || /^HTTP\/1\.1 [1-5]\d\d/.test(r), `${t} -> ${r}`);
    }
  }
  assert.match(await rawSend(port, "GET // HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"), /^HTTP\/1\.1 400/);
  assert.equal(await alive(), 404, "still serving after the malformed requests");
}

const status = async (port: number): Promise<number> =>
  Number((await rawSend(port, "GET /nothing HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")).split(" ")[1]);

test("the agent computer's stream server survives malformed requests", async () => {
  const port = await freePort();
  const s = startStreamServer({
    port,
    hub: {} as never,
    input: {} as never,
    takenOver: () => false,
    address: () => "127.0.0.1",
    onInput: () => {},
  });
  try {
    await new Promise((r) => setTimeout(r, 100));
    await fuzz(port, () => status(port));
  } finally {
    s.close();
  }
});

test("the Space browser's view server survives malformed requests", async () => {
  const port = await freePort();
  const s = startViewServer({ port, address: () => "127.0.0.1", viewOf: () => null });
  try {
    await new Promise((r) => setTimeout(r, 100));
    await fuzz(port, () => status(port));
  } finally {
    s.close();
  }
});

test("the Space browser's start page server survives malformed requests", async () => {
  const s = await startStartServer({ port: 0, data: () => ({ name: "A", face: "", recent: [] }) });
  try {
    const port = Number(new URL(s.url()).port);
    await fuzz(port, () => status(port));
  } finally {
    s.close();
  }
});
