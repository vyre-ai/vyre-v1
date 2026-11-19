// Which pages the carry door answers with CORS (r40, 18 Nov 2026): another Space's https page, and a page on the person's own machine over loopback http (a claim page opened through an SSH
// tunnel at http://localhost:8420, which reads "Couldn't reach that Space" when the door says nothing to it). Nothing else: not plain http on a name, not a lookalike of localhost.
import test from "node:test";
import assert from "node:assert/strict";
import type http from "node:http";
import { foreignOrigin } from "../src/routes/carry-door.ts";

const req = (origin: string | undefined, host = "mla.vyre.run"): http.IncomingMessage =>
  ({ headers: { ...(origin !== undefined ? { origin } : {}), host } }) as unknown as http.IncomingMessage;

test("another Space's https page and a loopback page are foreign; nothing else is", () => {
  const own = "https://mla.vyre.run";
  assert.equal(foreignOrigin(req("https://northwind.vyre.run"), own), "https://northwind.vyre.run");
  assert.equal(foreignOrigin(req("http://localhost:8420"), own), "http://localhost:8420");
  assert.equal(foreignOrigin(req("http://127.0.0.1:8420"), own), "http://127.0.0.1:8420");
  assert.equal(foreignOrigin(req("http://[::1]:8420"), own), "http://[::1]:8420");
  for (const no of [
    "http://beacon.example",
    "http://localhost.evil.example",
    "http://evil-localhost",
    "https://mla.vyre.run",
    "tauri://localhost",
    "http://tauri.localhost",
    "ftp://localhost",
    "null",
    "http://localhost:8420/path",
  ])
    assert.equal(foreignOrigin(req(no), own), null, no);
  assert.equal(foreignOrigin(req(undefined), own), null);
});

test("a page on loopback http that holds a session is passed through, as before; another site's https page holding one is refused", async () => {
  const { createCarryDoor } = await import("../src/routes/carry-door.ts");
  const door = createCarryDoor({ ownOrigin: () => null, call: async () => null });
  const http = await import("node:http");
  const server = http.createServer((req, res) => {
    if (door.handle(req, res)) return;
    res.writeHead(200, { "x-passed": "1" });
    res.end("ok");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/spaces/get`;
  try {
    const ask = (origin: string) =>
      fetch(url, {
        method: "POST",
        headers: { origin, authorization: "Bearer vst_session", "content-type": "application/json" },
        body: "{}",
      });
    const local = await ask("http://127.0.0.1:9999");
    assert.equal(local.status, 200, "a session from a loopback page goes on to the Space as it always did");
    assert.equal(local.headers.get("x-passed"), "1");
    // only the carry paths are the door's: a session token from another site's page on one of them is still refused
    const carryUrl = url.replace("/v1/spaces/get", "/v1/identity/whoami");
    const foreign = await fetch(carryUrl, {
      method: "POST",
      headers: {
        origin: "https://northwind.vyre.run",
        authorization: "Bearer vst_session",
        "content-type": "application/json",
      },
      body: "{}",
    });
    assert.equal(foreign.status, 403);
  } finally {
    server.close();
  }
});
