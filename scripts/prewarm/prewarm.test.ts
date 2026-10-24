import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { createServer, KEY } from "../../ci/fleet/cache-server.mjs";

const script = new URL("./prewarm.sh", import.meta.url).pathname;
const steps = ["mirror", "node_modules", "playwright", "docker", "template_dbs", "tsbuildinfo", "rust", "pass_cache", "expo"];

test("dry run lists every prewarm step and exits 0", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prewarm-"));
  const r = spawnSync("bash", [script], { env: { ...process.env, PREWARM_DRY: "1", PREWARM_ROOT: root }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  for (const s of steps) assert.match(r.stdout, new RegExp(`^prewarm ${s} skip `, "m"), s);
  assert.match(r.stdout, /prewarm done failed=0/);
});

test("a real run against a local repo mirrors it, skips absent inputs and warms the pass cache", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prewarm-"));
  const repo = path.join(root, "src");
  fs.mkdirSync(repo);
  const g = (...a: string[]) => spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  g("init", "-q", "-b", "main"); fs.writeFileSync(path.join(repo, "package.json"), "{}");
  g("add", "."); g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "x");
  const env = { ...process.env, PREWARM_ROOT: path.join(root, "cache"), PREWARM_REPO: repo, PREWARM_REF: "main", VYRE_PASS_CACHE: path.join(root, "pass") };
  const r = spawnSync("bash", [script], { env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^prewarm mirror ok .*cloned/m);
  assert.match(r.stdout, /^prewarm node_modules skip /m);
  assert.match(r.stdout, /^prewarm pass_cache ok /m);
  const again = spawnSync("bash", [script], { env, encoding: "utf8" });
  assert.match(again.stdout, /^prewarm mirror ok .*fetched/m);
});

const call = (port: number, method: string, p: string, body?: string) => new Promise<{ status: number; text: string }>((resolve, reject) => {
  const req = http.request({ port, method, path: p }, (res) => { let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => resolve({ status: res.statusCode ?? 0, text: t })); });
  req.on("error", reject); req.end(body);
});

test("cache server stores a blob once, serves it, and rejects bad keys", async () => {
  const srv = createServer(fs.mkdtempSync(path.join(os.tmpdir(), "cs-")));
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as { port: number }).port;
  try {
    assert.equal((await call(port, "GET", "/k/abcdef0123")).status, 404);
    assert.equal((await call(port, "PUT", "/k/abcdef0123", "hello")).status, 201);
    assert.deepEqual(await call(port, "GET", "/k/abcdef0123"), { status: 200, text: "hello" });
    assert.equal((await call(port, "PUT", "/k/abcdef0123", "other")).status, 409);
    assert.equal((await call(port, "GET", "/k/../etc")).status, 400);
    assert.equal((await call(port, "GET", "/health")).text, "ok");
    assert.ok(KEY.test("abcdef01") && !KEY.test("ABC"));
  } finally { srv.close(); }
});
