// The Doctor's Fix buttons on the machine: only rebuildable folders are cleared, idle sessions are stopped, a service is restarted by name.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearCaches, isFix, runFix } from "./machine-fix.ts";

test("clear_caches removes cache and tmp, scratch only when an hour old, and nothing else", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-fix-"));
  try {
    const put = (rel: string, bytes = 1000, ageMs = 0): void => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.alloc(bytes)); if (ageMs) { const t = new Date(Date.now() - ageMs); fs.utimesSync(p, t, t); } };
    put("cache/a/blob"); put("tmp/x"); put("scratch/old/f", 1000, 3 * 3600_000); put("scratch/new/f"); put("work/usr_a/thr_1/file.txt"); put("events.db"); put("files/doc.pdf");
    for (const rel of ["scratch/old", "scratch/new"]) { const p = path.join(dir, rel); const t = new Date(Date.now() - (rel.endsWith("old") ? 3 * 3600_000 : 0)); fs.utimesSync(p, t, t); }
    const freed = clearCaches(dir, Date.now());
    assert.equal(freed, 3000);
    assert.ok(!fs.existsSync(path.join(dir, "cache/a")) && !fs.existsSync(path.join(dir, "tmp/x")) && !fs.existsSync(path.join(dir, "scratch/old")));
    assert.ok(fs.existsSync(path.join(dir, "scratch/new/f")), "a scratch folder under an hour old may be a running turn's");
    for (const keep of ["work/usr_a/thr_1/file.txt", "events.db", "files/doc.pdf"]) assert.ok(fs.existsSync(path.join(dir, keep)), `${keep} is not a cache`);
    assert.match(await runFix("clear_caches", undefined, { dataDir: dir, now: Date.now }), /^Cleared 0 MB/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("stop_idle and restart_service answer in one plain line; an unknown fix is not one", async () => {
  const d = { dataDir: "/nope", now: Date.now };
  assert.equal(await runFix("stop_idle", undefined, { ...d, closeIdle: async () => 3 }), "Stopped 3 idle engine sessions.");
  assert.equal(await runFix("stop_idle", undefined, { ...d, closeIdle: async () => 1 }), "Stopped 1 idle engine session.");
  assert.equal(await runFix("stop_idle", undefined, { ...d, closeIdle: async () => 0 }), "No idle engine sessions.");
  assert.equal(await runFix("stop_idle", undefined, d), "No engine runs on this machine.");
  assert.equal(await runFix("restart_service", "caddy", { ...d, restart: async (s) => s === "caddy" }), "Restarted caddy.");
  assert.equal(await runFix("restart_service", "nope", { ...d, restart: async () => false }), "This machine has no service called nope.");
  assert.equal(isFix("format_disk"), false);
});
