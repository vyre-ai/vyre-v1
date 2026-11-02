// The Space serves its own app: a browser at the address or a join link gets the web export, an API path never gets a page, and nothing outside the export is read.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { appFileFor, createAppFilesRoute } from "./app-files.ts";

function exportDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-app-files-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>app</title>");
  fs.writeFileSync(path.join(dir, "chat.html"), "<!doctype html><title>chat</title>");
  fs.mkdirSync(path.join(dir, "_expo/static/js/web"), { recursive: true });
  fs.writeFileSync(path.join(dir, "_expo/static/js/web/entry-1.js"), "console.log(1)");
  fs.writeFileSync(path.join(dir, "favicon.ico"), "ico");
  fs.writeFileSync(path.join(os.tmpdir(), "vyre-app-files-secret.txt"), "secret");
  return dir;
}

async function serve(dir: string | null): Promise<{ url: string; close(): Promise<void> }> {
  const route = createAppFilesRoute({ dir: () => dir });
  const server = http.createServer((req, res) => { if (!route.handle(req, res)) { res.writeHead(404, { "content-type": "application/json" }); res.end('{"error":"gateway"}'); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => new Promise((r) => server.close(() => r())) };
}

const page = { accept: "text/html,application/xhtml+xml" };

test("a page the browser opens is the export's page for that path, the join link included; a hashed file is cached for good", async () => {
  const s = await serve(exportDir());
  try {
    const join = await fetch(`${s.url}/join/ABCD-1234`, { headers: page });
    assert.equal(join.status, 200);
    assert.match(await join.text(), /<title>app<\/title>/, "a path with no page of its own opens the app, which routes it");
    assert.match(join.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
    assert.equal(join.headers.get("cache-control"), "no-cache");
    assert.match(await (await fetch(`${s.url}/chat`, { headers: page })).text(), /<title>chat<\/title>/);
    const js = await fetch(`${s.url}/_expo/static/js/web/entry-1.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get("content-type") ?? "", /javascript/);
    assert.match(js.headers.get("cache-control") ?? "", /immutable/);
    assert.equal((await fetch(`${s.url}/favicon.ico`, { method: "HEAD" })).status, 200);
  } finally { await s.close(); }
});

test("the gateway's paths, a missing file that is not a page, another method, and a path out of the folder all fall through", async () => {
  const s = await serve(exportDir());
  try {
    for (const p of ["/v1/identity/whoami", "/sync/v1/ws", "/p/forms/x", "/.well-known/oauth-authorization-server", "/healthz", "/local/vault/key/status"]) {
      const r = await fetch(`${s.url}${p}`, { headers: page });
      assert.equal(r.status, 404, p);
      assert.equal(await r.text(), '{"error":"gateway"}', `${p} is the gateway's`);
    }
    assert.equal((await fetch(`${s.url}/missing.js`)).status, 404, "a file that is not there is not answered with a page when no page was asked for");
    assert.equal((await fetch(`${s.url}/`, { method: "POST", headers: page })).status, 404);
  } finally { await s.close(); }
  const dir = exportDir();
  assert.equal(appFileFor(dir, "/%2e%2e/vyre-app-files-secret.txt", true), null);
  assert.equal(appFileFor(dir, "/..%2fvyre-app-files-secret.txt", false), null);
  assert.equal(appFileFor(dir, "/a%00b", true), null);
  assert.equal(appFileFor(dir, "/%E0%A4%A", true), null);
});

test("a Space with no export answers nothing here: the gateway keeps every path", async () => {
  const s = await serve(null);
  try { assert.equal((await fetch(`${s.url}/`, { headers: page })).status, 404); } finally { await s.close(); }
});
