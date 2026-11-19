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
