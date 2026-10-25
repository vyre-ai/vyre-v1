// ctx.blobs on a booted daemon (P-CC_10): a module puts, reads, stats and deletes its own blobs through the invoke pipeline; another module cannot touch them; the bytes at rest are encrypted;
// the blobs survive a restart. The size and quota limits are proved on the store the daemon builds (same code, smaller caps).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";
import type { Blobs } from "../../packages/contracts/src/ctx.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";
import { HostError } from "../src/routes/errors.ts";
import { createBlobStore } from "../src/ctx/blobs.ts";

const bad = (code: string) => (e: unknown): boolean => e instanceof HostError && e.error.code === code;
const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));
function seededDir(): string {
  const core = bootCore();
  const dir = tmp("vyre-blobs-");
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}
function machine(dir: string) {
  return fakePlatform({
    os: "linux", hostname: "blobs-test", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  });
}
const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

const cap = (name: string, module: string) => ({
  name, v: 1, module, permission: null, level: "edit", resource: { type: "space" }, idempotency: "natural", effects: "write", risk: "low", emits: [],
  examples: [], surfaces: {}, input: {}, output: {}, errors: [], summary: "Blob test",
}) as unknown as CapabilityDef;
const route = (cap: string, p: string) => ({ method: "POST", path: p, cap, v: 1, effects: "write" as const });

type Op = { op: "put" | "get" | "stat" | "delete"; id?: string; text?: string; type?: string };
const enc = new TextEncoder(), dec = new TextDecoder();
async function run(ctx: { blobs?: Blobs }, i: Op): Promise<unknown> {
  const b = ctx.blobs;
  if (!b) throw new Error("ctx.blobs is not wired");
  if (i.op === "put") return b.put(enc.encode(i.text ?? ""), i.type ?? "text/plain");
  if (i.op === "get") { const r = await b.get(i.id!); return r ? { meta: r.meta, text: dec.decode(r.bytes) } : null; }
  if (i.op === "stat") return b.stat(i.id!);
  return b.delete(i.id!);
}

async function boot(dir: string): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: machine(dir), fetch: caddyFetch,
    extra: {
      caps: [cap("blobx.run", "blob-a"), cap("bloby.run", "blob-b")],
      routes: [route("blobx.run", "/v1/blobs/a"), route("bloby.run", "/v1/blobs/b")],
      handlers: { "blobx.run": run as never, "bloby.run": run as never },
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, tick: 3_600_000 },
  });
}
const call = async (d: Daemon, which: "a" | "b", body: Op) => {
  const r = await fetch(`${d.url}/v1/blobs/${which}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as { data?: any; error?: { code: string } } };
};

test("blobs: put, get, stat and delete round-trip through a handler on a booted daemon", async () => {
  const dir = seededDir();
  const d = await boot(dir);
  try {
    const put = await call(d, "a", { op: "put", text: "hello blob", type: "text/plain" });
    assert.equal(put.status, 200);
    const meta = put.body.data;
    assert.match(meta.id, /^blb_[a-f0-9]{32}$/);
    assert.equal(meta.size, 10);
    assert.equal(meta.contentType, "text/plain");
    assert.match(meta.sha256, /^[a-f0-9]{64}$/);
    const got = await call(d, "a", { op: "get", id: meta.id });
    assert.deepEqual(got.body.data, { meta, text: "hello blob" });
    assert.deepEqual((await call(d, "a", { op: "stat", id: meta.id })).body.data, meta);
    assert.equal((await call(d, "a", { op: "delete", id: meta.id })).body.data, true);
    assert.equal((await call(d, "a", { op: "get", id: meta.id })).body.data, null);
    assert.equal((await call(d, "a", { op: "stat", id: meta.id })).body.data, null);
    assert.equal((await call(d, "a", { op: "delete", id: meta.id })).body.data, false, "deleting twice is a no-op");
    assert.equal((await call(d, "a", { op: "get", id: "../../seal.key" })).body.data, null, "a path is not an id");
  } finally { await d.stop(); }
});

test("blobs: another module cannot read, stat or delete a module's blob", async () => {
  const dir = seededDir();
  const d = await boot(dir);
  try {
    const { id } = (await call(d, "a", { op: "put", text: "private to a" })).body.data;
    for (const op of ["get", "stat", "delete"] as const) {
      const r = await call(d, "b", { op, id });
      assert.notEqual(r.status, 200, `${op} by the other module is refused`);
      assert.equal(r.body.error?.code, "permission.no_grant");
    }
    assert.equal((await call(d, "a", { op: "get", id })).body.data.text, "private to a", "the owner still has it");
    assert.equal((await call(d, "b", { op: "get", id: `blb_${"0".repeat(32)}` })).body.data, null, "an id nobody stored is simply absent");
  } finally { await d.stop(); }
});

test("blobs: bytes are encrypted at rest and survive a restart", async () => {
  const dir = seededDir();
  let d = await boot(dir);
  let id: string;
  try {
    id = (await call(d, "a", { op: "put", text: "plain-text-secret-123" })).body.data.id;
    const files = fs.readdirSync(path.join(dir, "blobs", "ctx"));
    assert.ok(files.includes(`${id}.bin`) && files.includes(`${id}.json`));
    assert.ok(!fs.readFileSync(path.join(dir, "blobs", "ctx", `${id}.bin`)).includes("plain-text-secret-123"), "the stored bytes do not contain the text");
    assert.equal(fs.statSync(path.join(dir, "blobs", "ctx", `${id}.bin`)).mode & 0o777, 0o600);
  } finally { await d.stop(); }
  d = await boot(dir);
  try { assert.equal((await call(d, "a", { op: "get", id })).body.data.text, "plain-text-secret-123"); } finally { await d.stop(); }
});

test("blobs: a blob over the size limit and a module over its quota are refused; deleting frees quota", async () => {
  const dir = tmp("vyre-blobs-limits-");
  const store = createBlobStore({ dir, key: "0123456789abcdef0123456789abcdef", maxBlobBytes: 8, maxModuleBytes: 12 });
  const a = store.forModule("blob-a"), b = store.forModule("blob-b");
  await assert.rejects(a.put(new Uint8Array(9), "x/y"), bad("validation.too_large"));
  const one = await a.put(new Uint8Array(8), "x/y");
  await assert.rejects(a.put(new Uint8Array(8), "x/y"), bad("validation.too_large"), "12 byte quota");
  await b.put(new Uint8Array(8), "x/y");                       // the quota is per module
  assert.equal(store.usage("blob-a"), 8);
  await a.delete(one.id);
  assert.equal(store.usage("blob-a"), 0);
  await a.put(new Uint8Array(8), "x/y");
  await assert.rejects(a.put(enc.encode("x") as Uint8Array, ""), bad("validation.bad_input"), "a content type is required");
  // a tampered file does not open
  const keep = await a.put(new Uint8Array(1), "x/y");
  const f = path.join(dir, `${keep.id}.bin`);
  const raw = fs.readFileSync(f); raw[raw.length - 1] = raw[raw.length - 1]! ^ 1; fs.writeFileSync(f, raw);
  await assert.rejects(a.get(keep.id));
});
