// Pass cache (ARCH 10.2): a pass is stored as a marker { key, durationMs, tests }, keyed by the import-closure hash from scripts/lib/graph.mjs.
// Runner-local directory plus an optional mirror on the fleet cache server (HTTP content-addressed store: GET/PUT <url>/<key>).
// Failures are never stored. Files tagged `// @nocache` are never stored or looked up. The mirror is best effort and never fails a run.
import fs from "node:fs";
import path from "node:path";
import { cacheKey } from "../lib/graph.mjs";

export type Marker = { key: string; durationMs: number; tests: number };
export type CacheEnv = { node: string; runner: string; tag: string };
export interface PassCache {
  get(key: string): Promise<Marker | null>;
  put(marker: Marker): Promise<void>;
}
type FetchLike = (url: string, init?: { method?: string; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const KEY = /^[0-9a-f]{64}$/;
const isMarker = (m: any, key: string): m is Marker => !!m && m.key === key && Number.isFinite(m.durationMs) && Number.isFinite(m.tests);

/** True when the file opts out of caching (time or network dependent). */
export function isNoCache(src: string): boolean {
  return /^\s*\/\/\s*@nocache\b/m.test(src);
}

/** Cache key for a test file: content of its sorted transitive closure, node version, runner version and env tag. */
export function passKey(file: string, fwd: Map<string, Set<string>>, read: (f: string) => string, env: CacheEnv): string {
  return cacheKey(file, fwd, read, env);
}

/** Markers as files in one directory. A corrupt or foreign file reads as a miss. */
export function localCache(dir: string): PassCache {
  fs.mkdirSync(dir, { recursive: true });
  return {
    async get(key) {
      if (!KEY.test(key)) return null;
      try {
        const m = JSON.parse(fs.readFileSync(path.join(dir, key), "utf8"));
        return isMarker(m, key) ? m : null;
      } catch { return null; }
    },
    async put(m) {
      if (!KEY.test(m.key)) return;
      const tmp = path.join(dir, `.${m.key}.${process.pid}`);
      try { fs.writeFileSync(tmp, JSON.stringify(m)); fs.renameSync(tmp, path.join(dir, m.key)); } catch { /* best effort */ }
    },
  };
}

/** Local first, then the fleet mirror. A mirror hit is copied into the local cache. Mirror errors and slow replies count as misses. */
export function mirroredCache(local: PassCache, opts: { url: string; fetch?: FetchLike; timeoutMs?: number }): PassCache {
  const f: FetchLike = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const base = opts.url.replace(/\/+$/, ""), timeoutMs = opts.timeoutMs ?? 1500;
  const call = async (url: string, init: { method?: string; body?: string }) => {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), timeoutMs);
    try { return await f(url, { ...init, signal: ac.signal }); } finally { clearTimeout(t); }
  };
  return {
    async get(key) {
      const hit = await local.get(key);
      if (hit) return hit;
      if (!KEY.test(key)) return null;
      try {
        const r = await call(`${base}/${key}`, {});
        if (!r.ok) return null;
        const m = JSON.parse(await r.text());
        if (!isMarker(m, key)) return null;
        await local.put(m);
        return m;
      } catch { return null; }
    },
    async put(m) {
      await local.put(m);
      if (!KEY.test(m.key)) return;
      try { await call(`${base}/${m.key}`, { method: "PUT", body: JSON.stringify(m) }); } catch { /* best effort */ }
    },
  };
}

/** Local cache, mirrored when VYRE_CACHE_URL is set. Directory: VYRE_PASS_CACHE, then the fleet path, then the OS temp dir. */
export function defaultCache(env: Record<string, string | undefined>, tmp: string): PassCache | null {
  for (const d of [env.VYRE_PASS_CACHE, "/var/lib/ci-run/pass-cache-v1", path.join(tmp, "pass-cache-v1")]) {
    if (!d) continue;
    try {
      fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK);
      const local = localCache(d);
      return env.VYRE_CACHE_URL ? mirroredCache(local, { url: env.VYRE_CACHE_URL }) : local;
    } catch { /* next */ }
  }
  return null;
}

/** Splits candidates into files to run and files whose closure is unchanged since a recorded pass. */
export async function splitByCache(
  files: string[], fwd: Map<string, Set<string>>, read: (f: string) => string, env: CacheEnv, cache: PassCache | null,
): Promise<{ run: string[]; hit: string[]; keys: Map<string, string> }> {
  const run: string[] = [], hit: string[] = [], keys = new Map<string, string>();
  for (const f of files) {
    let src = "";
    try { src = read(f); } catch { /* unreadable: run it */ }
    if (!cache || isNoCache(src)) { run.push(f); continue; }
    const key = passKey(f, fwd, read, env);
    keys.set(f, key);
    if (await cache.get(key)) hit.push(f); else run.push(f);
  }
  return { run, hit, keys };
}

/** Stores a pass. Returns false (and stores nothing) for a failure. */
export async function recordResult(cache: PassCache | null, key: string | undefined, r: { ok: boolean; ms: number; tests: number }): Promise<boolean> {
  if (!cache || !key || !r.ok) return false;
  await cache.put({ key, durationMs: r.ms, tests: r.tests });
  return true;
}
