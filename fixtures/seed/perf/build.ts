// The `perf` seed (ARCH 9, 10.3): the small seed's shape at the sizes the speed budgets are measured on, built THROUGH the capability API on a booted daemon and cached as a directory template.
// Full scale is 100k contacts, 2k tasks, 200 channels, 50 agents (10k messages and 10k file rows too, when the chat and files modules can take them). `ci` is a hundredth of that, for tests that
// check the builder itself in the fast lane. The scale is part of the template name, the recipe sources and the registry hash are the key.
//
// What is not built through capabilities, and why: messages (the chat module has no handlers yet), file rows (the files migrations never create files_file, so every files call answers 500), agents
// (agents.create needs files), channels (resources only, no capability makes one). Each is recorded in perf.json under `gaps`; agents and channels fall back to kernel events the way core builds its own.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { routes } from "../../../generated/routes.ts";
import { LogStore } from "../../../kernel/src/log/store.ts";
import type { NewEvent } from "../../../kernel/src/log/types.ts";
import type { Daemon } from "../../../host/src/daemon/daemon.ts";
import { fillAccessTables } from "../core/access.ts";
import { fillIdentityTables } from "../core/identity.ts";
import { CORE_SPACE, PEOPLE, bootCore, cacheDir, registryHash, templateKey } from "../core/index.ts";
import { SMALL_SOURCES, SMALL_LIVE, startSeeded } from "../small/build.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PERF_SOURCES: readonly string[] = [...SMALL_SOURCES, fileURLToPath(import.meta.url), path.join(HERE, "recipe.ts")];
export const PERF_LIVE: readonly string[] = [...SMALL_LIVE, "tasks"];
const KEEP = ["events.db", "modules.db", "space.db", "seal.key", "perf.json"];

export type PerfScale = "full" | "ci";
export interface PerfSizes { contacts: number; tasks: number; channels: number; agents: number; messages: number; files: number }
export const PERF_SIZES: Readonly<Record<PerfScale, PerfSizes>> = Object.freeze({
  full: { contacts: 100_000, tasks: 2_000, channels: 200, agents: 50, messages: 10_000, files: 10_000 },
  ci: { contacts: 1_000, tasks: 20, channels: 20, agents: 12, messages: 100, files: 100 },
});
/** Rows per bulk_upsert call. */
const CHUNK = 2_500;

const TRACE = "6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b";
const event = (n: number, type: string, entity: string, id: string, payload: unknown): NewEvent => ({ id: `evt_perf_${String(n).padStart(6, "0")}`, type, sv: 1, trace_id: TRACE, actor: "svc_seed", vis: "space", entity, entity_id: id, payload });
const resource = (n: number, id: string, type: string): NewEvent => event(n, "resource.created", "resource", id, { id, type, parent_id: CORE_SPACE, label: 0, owner_id: "usr_olivia", holds: 0 });

/** Kernel additions before the first boot: the built-in record type resources and the channels beyond core's one. */
export function extraEvents(sizes: PerfSizes): NewEvent[] {
  const out: NewEvent[] = [];
  let n = 0;
  for (const type of ["contact", "company"]) out.push(resource(++n, type, "record_type"));
  for (const id of ["agt_scout", "agt_helper"]) out.push(resource(++n, id, "agent"));
  for (let i = 1; i < sizes.channels; i++) out.push(resource(++n, `chn_p${String(i).padStart(3, "0")}`, "channel"));
  return out;
}

/** Contact rows, deterministic. */
export function contactRows(from: number, count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, k) => ({ name: `Contact ${from + k}`, email: `c${from + k}@perf.example.test` }));
}

async function call(d: Daemon, cap: string, body: unknown): Promise<unknown> {
  const route = routes.find((r) => r.cap === cap);
  if (!route) throw new Error(`no route for ${cap}`);
  const res = await fetch(`${d.url}${route.path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(body) });
  const text = await res.text();
  if (res.status !== 200) throw new Error(`${cap} answered ${res.status}: ${text.slice(0, 300)}`);
  return (JSON.parse(text) as { data: unknown }).data;
}

export interface PerfBuildTimings { coreMs: number; bootMs: number; contactsMs: number; tasksMs: number; totalMs: number }
let lastBuild: PerfBuildTimings | null = null;
export const lastPerfBuild = (): PerfBuildTimings | null => lastBuild;

async function build(into: string, sizes: PerfSizes): Promise<void> {
  const gaps: string[] = [];
  const t0 = performance.now();
  const core = bootCore();
  for (const r of core.store.appendBatch(extraEvents(sizes))) if (!r.ok) throw new Error(`seed event refused: ${r.message}`);
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(into, "events.db"));
  core.close();
  const t1 = performance.now();
  const d = await startSeeded(into, PERF_LIVE);
  const t2 = performance.now();
  let t3 = t2, t4 = t2;
  try {
    await call(d, "schema.types.list", {});   // the built-in types are materialised lazily: records answers "no type contact" before the schema module is read
    for (let from = 0; from < sizes.contacts; from += CHUNK) {
      const count = Math.min(CHUNK, sizes.contacts - from);
      const out = (await call(d, "records.bulk_upsert", { idempotencyKey: `perf-contacts-${from}`, type: "contact", rows: contactRows(from, count), match: ["email"] })) as { created: number };
      if (out.created !== count) throw new Error(`records.bulk_upsert created ${out.created} of ${count}`);
    }
    t3 = performance.now();
    for (let i = 0; i < sizes.tasks; i++) {
      await call(d, "tasks.create", { idempotencyKey: `perf-task-${i}`, title: `Perf task ${i}`, assigned: { kind: "person", id: PEOPLE[i % PEOPLE.length]!.id } });
    }
    t4 = performance.now();
    gaps.push("messages: the chat module has no handlers, so no capability writes a message", "files: files migrations never create files_file, so files.create answers 500");
  } finally { await d.stop(); }
  // agents: agents.create needs the files tree, so they are kernel principals (as core's own two are)
  const made = sizes.agents - 2;
  gaps.push("agents: agents.create needs files; the agents are kernel principals");
  const store = new LogStore({ db: new DatabaseSync(path.join(into, "events.db")), space: CORE_SPACE });
  const more: NewEvent[] = [];
  for (let i = 1; i <= made; i++) {
    const id = `agt_perf${String(i).padStart(3, "0")}`;
    more.push(event(1000 + more.length, "principal.created", "principal", id, { id, kind: "agent", owner: PEOPLE[i % PEOPLE.length]!.id, status: "active", name: `Agent ${i}` }));
    more.push(event(1000 + more.length, "principal.role_set", "principal", id, { holder: id, role: "member" }));
  }
  for (const r of store.appendBatch(more)) if (!r.ok) throw new Error(`seed event refused: ${r.message}`);
  store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  store.close();
  {
    const log = new DatabaseSync(path.join(into, "events.db"), { readOnly: true });
    const events = (log.prepare("SELECT event, payload FROM events ORDER BY seq").all() as { event: string; payload: Uint8Array }[]).map((r) => ({ type: (JSON.parse(r.event) as { type: string }).type, payload: r.payload }));
    log.close();
    const mod = new DatabaseSync(path.join(into, "modules.db"));
    const target = { run: (sql: string, ...args: unknown[]) => mod.prepare(sql).run(...(args as never[])) };
    fillAccessTables(target, events);
    fillIdentityTables(target, CORE_SPACE, events);
    mod.close();
  }
  fs.writeFileSync(path.join(into, "perf.json"), JSON.stringify({ gaps, sizes }));
  for (const f of ["modules.db", "events.db", "space.db"]) {
    const file = path.join(into, f);
    if (!fs.existsSync(file)) continue;
    const db = new DatabaseSync(file);
    db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
    db.close();
  }
  for (const f of fs.readdirSync(into)) if (!KEEP.includes(f)) fs.rmSync(path.join(into, f), { recursive: true, force: true });
  lastBuild = { coreMs: t1 - t0, bootMs: t2 - t1, contactsMs: t3 - t2, tasksMs: t4 - t3, totalMs: performance.now() - t0 };
}

export interface BootPerfOptions { scale?: PerfScale; cache?: string; scratch?: string; sources?: readonly string[]; registry?: string }
export interface PerfSpace {
  /** A private data directory holding the seed: boot a daemon on it with `startSeeded(dir, PERF_LIVE)`. */
  dir: string;
  space: string;
  scale: PerfScale;
  sizes: PerfSizes;
  hit: boolean;
  key: string;
  /** What could not be built through capabilities, and why. */
  gaps: string[];
  close(): void;
}

/** The perf seed as a private copy of the cached template (copy-on-write where the filesystem has it), building the template first when the cache has none. */
export async function bootPerf(o: BootPerfOptions = {}): Promise<PerfSpace> {
  const scale = o.scale ?? "ci";
  const sizes = PERF_SIZES[scale];
  const key = templateKey(o.sources ?? PERF_SOURCES, o.registry ?? registryHash());
  const tpl = path.join(o.cache ?? cacheDir(), `perf-${scale}-${key}`);
  let hit = true;
  if (!fs.existsSync(tpl)) {
    hit = false;
    const tmp = `${tpl}.${process.pid}.${Date.now().toString(36)}.tmp`;
    fs.mkdirSync(tmp, { recursive: true });
    try {
      await build(tmp, sizes);
      try { fs.renameSync(tmp, tpl); } catch { /* another runner finished first: its template is the same */ }
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  const dir = fs.mkdtempSync(path.join(o.scratch ?? os.tmpdir(), "perf-seed-"));
  for (const f of KEEP) if (fs.existsSync(path.join(tpl, f))) fs.copyFileSync(path.join(tpl, f), path.join(dir, f), fs.constants.COPYFILE_FICLONE);
  const meta = JSON.parse(fs.readFileSync(path.join(tpl, "perf.json"), "utf8")) as { gaps: string[] };
  return { dir, space: CORE_SPACE, scale, sizes, hit, key, gaps: meta.gaps, close: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
