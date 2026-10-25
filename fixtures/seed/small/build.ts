// The `small` seed (ARCH 10.3, spec 5 b14): the frozen `core` Space grown to about 500 records, 40 channels and 12 agents, 6 people with every role, built THROUGH the capability API on a booted
// daemon (so the seed also tests the API) and cached as a directory template keyed by the hash of this recipe, the core sources and the registry hash. A cache hit is a directory copy.
//
// What it is built from. People, roles, groups, one channel and the folder tree come from `core`. The kernel-level facts a module cannot make for itself are appended to the core log before
// the first boot: the 39 more channels, and the authorization resources of the built-in record types (`contact`, `company`), which the records module needs to find under the Space. Everything
// else goes through the gateway with the daemon's owner token: 500 contacts (records.bulk_upsert) and 12 agents (agents.create, which builds each agent's Agents/<name> tree through files).
// Channels stay resources only: the chat module has no handlers yet, so there is no capability that makes a channel. Agents are made with agents.create; while that cannot work (the files module's
// tables are incomplete) the builder records the reason in small.json (`gaps`) and adds the missing agents as kernel principals, the way core adds its own two, so the seed still has 12.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { routes } from "../../../generated/routes.ts";
import { fakePlatform } from "../../../host/src/platform/index.ts";
import type { FetchFn } from "../../../host/src/platform/probes.ts";
import { loadConfig } from "../../../host/src/daemon/config.ts";
import { startDaemon } from "../../../host/src/daemon/daemon.ts";
import type { Daemon } from "../../../host/src/daemon/daemon.ts";
import type { NewEvent } from "../../../kernel/src/log/types.ts";
import { LogStore } from "../../../kernel/src/log/store.ts";
import { CORE_SOURCES, CORE_SPACE, PEOPLE, REPO, bootCore, cacheDir, registryHash, templateKey } from "../core/index.ts";
import { SMALL_TARGET } from "./recipe.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The files whose content defines the seed. */
export const SMALL_SOURCES: readonly string[] = [...CORE_SOURCES, fileURLToPath(import.meta.url), path.join(HERE, "recipe.ts")];
/** The modules the seed is built with. A test that boots the seed may flip more. */
export const SMALL_LIVE: readonly string[] = ["records", "schema", "contacts-link", "agents", "files", "access", "devices", "spaces"];
/** The files of a Space's data directory that make up the seed (the rest is per boot: pid, info, logs, admin token). */
const KEEP = ["events.db", "modules.db", "space.db", "seal.key", "small.json"];

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

/** A code root that is this repo with `live` flipped in host/modules.json: every top-level entry a symlink, host/ rebuilt around an edited modules.json. */
export function codeRootWithLive(live: readonly string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-small-root-"));
  for (const name of fs.readdirSync(REPO)) if (name !== ".git" && name !== "host") fs.symlinkSync(path.join(REPO, name), path.join(root, name));
  fs.mkdirSync(path.join(root, "host"));
  for (const name of fs.readdirSync(path.join(REPO, "host"))) if (name !== "modules.json") fs.symlinkSync(path.join(REPO, "host", name), path.join(root, "host", name));
  const list = JSON.parse(fs.readFileSync(path.join(REPO, "host/modules.json"), "utf8")) as { modules: { id: string; status: string }[] };
  for (const id of live) {
    const m = list.modules.find((x) => x.id === id);
    if (!m) throw new Error(`host/modules.json does not list ${id}`);
    m.status = "live";
  }
  fs.writeFileSync(path.join(root, "host/modules.json"), JSON.stringify(list));
  return root;
}

/** Starts a daemon on a data directory holding a seed, with `live` flipped on. The owner token is `d.token`. */
export function startSeeded(dir: string, live: readonly string[] = SMALL_LIVE): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot: codeRootWithLive(live),
    platform: fakePlatform({
      os: "linux", hostname: "small-seed", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, tick: 3_600_000, hooks: 3_600_000 },
  });
}

/** Agents beyond the two of core, so the Space ends with SMALL_TARGET.agents. */
const MODULE_AGENTS = SMALL_TARGET.agents - 2;
const TRACE = "5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a";
const ev = (n: number, entity: string, id: string, payload: unknown): NewEvent => ({
  id: `evt_small_${String(n).padStart(4, "0")}`, type: "resource.created", sv: 1, trace_id: TRACE, actor: "svc_seed", vis: "space", entity, entity_id: id, payload,
});
const resource = (n: number, id: string, type: string): NewEvent => ev(n, "resource", id, { id, type, parent_id: CORE_SPACE, label: 0, owner_id: "usr_olivia", holds: 0 });

/** The kernel-level additions to the core log: channels up to the target, and the resources of the built-in record types. */
export function extraEvents(): NewEvent[] {
  const out: NewEvent[] = [];
  let n = 0;
  for (const type of ["contact", "company"]) out.push(resource(++n, type, "record_type"));
  for (let i = 1; i < SMALL_TARGET.channels; i++) out.push(resource(++n, `chn_s${String(i).padStart(2, "0")}`, "channel"));
  return out;
}

const FIRST = ["Ann", "Ben", "Cara", "Dev", "Eli", "Fay", "Gus", "Hana", "Ivo", "Jun"];
const LAST = ["Adams", "Brooks", "Chen", "Diaz", "Evans", "Fox", "Gray", "Hill", "Ito", "Jones"];
/** Contact rows, deterministic: the same 500 every build. */
export function contactRows(n: number = SMALL_TARGET.records): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({ name: `${FIRST[i % 10]} ${LAST[Math.floor(i / 10) % 10]} ${i}`, email: `person${i}@small.example.test` }));
}

async function call(d: Daemon, cap: string, body: unknown): Promise<unknown> {
  const route = routes.find((r) => r.cap === cap);
  if (!route) throw new Error(`no route for ${cap}`);
  const res = await fetch(`${d.url}${route.path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(body) });
  const text = await res.text();
  if (res.status !== 200) throw new Error(`${cap} answered ${res.status}: ${text.slice(0, 400)}`);
  return (JSON.parse(text) as { data: unknown }).data;
}

export interface BuildTimings { coreMs: number; bootMs: number; recordsMs: number; agentsMs: number; totalMs: number }
let lastBuild: BuildTimings | null = null;
/** The timings of the most recent cold build in this process, or null when every boot was a cache hit. */
export const lastBuildTimings = (): BuildTimings | null => lastBuild;

/** Builds the template into `into` (an empty directory): core log plus extras, then the capability calls on a booted daemon. */
async function build(into: string): Promise<void> {
  const gaps: string[] = [];
  let madeByModule = 0;
  const t0 = performance.now();
  const core = bootCore();
  for (const r of core.store.appendBatch(extraEvents())) if (!r.ok) throw new Error(`seed event refused: ${r.message}`);
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(into, "events.db"));
  core.close();
  const t1 = performance.now();
  const d = await startSeeded(into);
  const t2 = performance.now();
  try {
    // records.bulk_upsert answers "no type contact" until the schema module has been read once: the built-in types are materialised lazily (reported on the packet). Listing them first is the read.
    await call(d, "schema.types.list", {});
    const out = (await call(d, "records.bulk_upsert", { idempotencyKey: "small-contacts", type: "contact", rows: contactRows(), match: ["email"] })) as { created: number };
    if (out.created !== SMALL_TARGET.records) throw new Error(`records.bulk_upsert created ${out.created} of ${SMALL_TARGET.records}`);
    const t3 = performance.now();
    for (let i = 1; i <= MODULE_AGENTS; i++) {
      try { await call(d, "agents.create", { idempotencyKey: `small-agent-${i}`, name: `Agent ${String(i).padStart(2, "0")}`, role: `Seed agent ${i}` }); madeByModule++; } catch (e) {
        gaps.push(`agents.create: ${(e as Error).message.slice(0, 600)}`);
        break;
      }
    }
    const t4 = performance.now();
    lastBuild = { coreMs: t1 - t0, bootMs: t2 - t1, recordsMs: t3 - t2, agentsMs: t4 - t3, totalMs: t4 - t0 };
  } finally { await d.stop(); }
  // agents the module could not make: kernel principals, like core's own two
  if (madeByModule < MODULE_AGENTS) {
    const store = new LogStore({ db: new DatabaseSync(path.join(into, "events.db")), space: CORE_SPACE });
    const more: NewEvent[] = [];
    for (let i = madeByModule + 1; i <= MODULE_AGENTS; i++) {
      const id = `agt_small${String(i).padStart(2, "0")}`;
      const owner = PEOPLE[i % PEOPLE.length]!.id;
      const e = (type: string, entity: string, entityId: string, payload: unknown): NewEvent => ({ id: `evt_smallagt_${String(more.length + 1).padStart(4, "0")}`, type, sv: 1, trace_id: TRACE, actor: "svc_seed", vis: "space", entity, entity_id: entityId, payload });
      more.push(e("principal.created", "principal", id, { id, kind: "agent", owner, status: "active", name: `Agent ${String(i).padStart(2, "0")}` }));
      more.push(e("principal.role_set", "principal", id, { holder: id, role: "member" }));
    }
    for (const r of store.appendBatch(more)) if (!r.ok) throw new Error(`seed event refused: ${r.message}`);
    store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
    store.close();
  }
  fs.writeFileSync(path.join(into, "small.json"), JSON.stringify({ gaps, agentsByModule: madeByModule }));
  for (const f of ["modules.db", "events.db", "space.db"]) {
    const file = path.join(into, f);
    if (!fs.existsSync(file)) continue;
    const db = new DatabaseSync(file);
    db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
    db.close();
  }
  for (const f of fs.readdirSync(into)) if (!KEEP.includes(f)) fs.rmSync(path.join(into, f), { recursive: true, force: true });
}

export interface BootSmallOptions { cache?: string; scratch?: string; sources?: readonly string[]; registry?: string }
export interface SmallSpace {
  /** A private data directory holding the seed: boot a daemon on it with `startSeeded(dir)`. */
  dir: string;
  space: string;
  /** Was the template already cached? */
  hit: boolean;
  key: string;
  /** Why parts of the seed could not be built through capabilities (empty when everything was). */
  gaps: string[];
  /** How many agents came from agents.create rather than from kernel events. */
  agentsByModule: number;
  close(): void;
}

/** The small seed as a private copy of the cached template, building the template first when the cache has none for this key. */
export async function bootSmall(o: BootSmallOptions = {}): Promise<SmallSpace> {
  const key = templateKey(o.sources ?? SMALL_SOURCES, o.registry ?? registryHash());
  const cache = o.cache ?? cacheDir();
  const tpl = path.join(cache, `small-${key}`);
  let hit = true;
  if (!fs.existsSync(tpl)) {
    hit = false;
    const tmp = `${tpl}.${process.pid}.${Date.now().toString(36)}.tmp`;
    fs.mkdirSync(tmp, { recursive: true });
    try {
      await build(tmp);
      try { fs.renameSync(tmp, tpl); } catch { /* another runner finished first: its template is the same */ }
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  const dir = fs.mkdtempSync(path.join(o.scratch ?? os.tmpdir(), "small-seed-"));
  for (const f of KEEP) if (fs.existsSync(path.join(tpl, f))) fs.copyFileSync(path.join(tpl, f), path.join(dir, f));
  const meta = JSON.parse(fs.readFileSync(path.join(tpl, "small.json"), "utf8")) as { gaps: string[]; agentsByModule: number };
  return { dir, space: CORE_SPACE, hit, key, gaps: meta.gaps, agentsByModule: meta.agentsByModule, close: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
