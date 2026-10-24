// The seed template cache (ARCH 10.3): a seed is built once into a database file, keyed by the hash of its recipe source plus the registry hash, and every test copies that file. A cache
// hit is a file copy and an open; a miss builds into a temp name and renames it in, so two runners never see a half-written template.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function cacheDir(): string {
  const want = [process.env["VYRE_SEED_CACHE"], "/var/lib/ci-run/seed-cache-v1", path.join(os.tmpdir(), "seed-cache-v1")];
  for (const d of want) {
    if (!d) continue;
    try { fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); return d; } catch { /* next */ }
  }
  throw new Error("no writable seed cache directory");
}

/** sha-256 of every recipe source file plus the registry hash. */
export function templateKey(recipeFiles: readonly string[], registryHash: string): string {
  const h = crypto.createHash("sha256");
  for (const f of [...recipeFiles].sort()) h.update(f).update("\0").update(fs.readFileSync(f)).update("\0");
  return h.update(registryHash.trim()).digest("hex").slice(0, 32);
}

export interface Template { path: string; hit: boolean }

/** The template file for `key`, built by `build(tmpPath)` when missing. */
export function ensureTemplate(dir: string, name: string, key: string, build: (file: string) => void): Template {
  const file = path.join(dir, `${name}-${key}.db`);
  if (fs.existsSync(file)) return { path: file, hit: true };
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try { build(tmp); fs.renameSync(tmp, file); } finally { fs.rmSync(tmp, { force: true }); fs.rmSync(`${tmp}-wal`, { force: true }); fs.rmSync(`${tmp}-shm`, { force: true }); }
  return { path: file, hit: false };
}

/** A private copy of a template, so a test may write. */
export function copyTemplate(t: Template, into: string): string {
  const file = path.join(into, `seed-${crypto.randomBytes(6).toString("hex")}.db`);
  fs.copyFileSync(t.path, file);
  return file;
}
