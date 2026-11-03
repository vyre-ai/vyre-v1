// Redaction for AI on the blob route: a picture of a file (a preview, a page, a thumbnail) cannot carry [REDACTED], so an agent or an outside actor asking for one of a file the read gate refuses
// gets 403, while a person who may read the file still gets the picture. Over a real node:http server and a real encrypted blob store.
// @reads /host/src/routes/blobs.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createBlobStore } from "../src/ctx/blobs.ts";
import { blobPath, createBlobRoute } from "../src/routes/blobs.ts";
import type { BlobCaller } from "../src/routes/blobs.ts";

const SPACE = "spc_core";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const TOKENS: Record<string, BlobCaller> = {
  irfad: { space: SPACE, principal: { kind: "person", id: "usr_irfad" } },
  intake: { space: SPACE, principal: { kind: "agent", id: "agt_intake" }, actingFor: "usr_irfad" },
  robot: { space: SPACE, principal: { kind: "actor", id: "act_robot" } },
};

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-blobs-redact-"));
  const store = createBlobStore({ dir, key: new Uint8Array(32).fill(7) });
  const scan = await store.forModule("previews").put(PNG, "image/png", { resource: { type: "file", id: "fil_er_scan" } });
  const clear = await store.forModule("previews").put(PNG, "image/png", { resource: { type: "file", id: "fil_menu" } });
  const asked: string[] = [];
  const route = createBlobRoute({
    space: SPACE, store,
    session: (h) => TOKENS[String(h["authorization"] ?? "").replace(/^Bearer /, "")] ?? null,
    allow: () => true,
    agentRead: async (c, r) => { asked.push(`${c.principal.id}:${r.id}`); return r.id !== "fil_er_scan"; },
  });
  const server = http.createServer((req, res) => { if (!route.handle(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = (id: string, who: string) => fetch(`${base}${blobPath(SPACE, id)}`, { headers: { authorization: `Bearer ${who}` } });
  return { scan, clear, asked, get, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

test("an agent and an outside actor are refused the picture of a file the gate refuses; a person is not asked about and gets it", async (t) => {
  const w = await boot();
  t.after(w.close);
  assert.equal((await w.get(w.scan.id, "intake")).status, 403);
  assert.equal((await w.get(w.scan.id, "robot")).status, 403);
  assert.equal((await w.get(w.clear.id, "intake")).status, 200, "a picture of a clear file is served as before");
  const person = await w.get(w.scan.id, "irfad");
  assert.equal(person.status, 200);
  assert.deepEqual(new Uint8Array(await person.arrayBuffer()), PNG);
  assert.deepEqual(w.asked, ["agt_intake:fil_er_scan", "act_robot:fil_er_scan", "agt_intake:fil_menu"], "only agents and actors are asked about");
});
