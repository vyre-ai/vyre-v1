// Probe index and fast-lane selection (ARCH 9).
// Screen probes are read from generated/probes.json. Budget probes are declared here.
// refreshProbes writes perf/generated/probes.json. Do not hand-edit that file.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Budget, Probe } from "./types.ts";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const SCREEN_PROBES = "generated/probes.json";
export const PROBES_OUT = "perf/generated/probes.json";

/** Path prefixes each budget probe owns. A change under the prefix selects that row. */
const CATALOG: Array<{ id: string; spans: string[]; files: string[] }> = [
  { id: "startup", spans: ["app.start", "app.usable"], files: ["apps/", "client/", "ui/", "host/"] },
  { id: "navigate", spans: ["nav.open"], files: ["ui/", "client/", "apps/"] },
  { id: "search", spans: ["search.local"], files: ["modules/search/", "client/"] },
  { id: "search_server", spans: ["search.server"], files: ["modules/search/", "host/"] },
  { id: "chat_open", spans: ["chat.open_ready"], files: ["modules/chat/", "client/", "ui/"] },
  { id: "send", spans: ["msg.send_visible"], files: ["modules/chat/", "host/", "agent/"] },
  { id: "send_token", spans: ["turn.first_token_overhead"], files: ["agent/", "modules/engine/", "modules/chat/"] },
  { id: "scroll", spans: ["frame"], files: ["ui/"] },
  { id: "space_switch", spans: ["space.switch"], files: ["client/", "ui/", "modules/spaces/"] },
  { id: "edit", spans: ["edit.local"], files: ["perf/harness/headless.ts", "client/", "sync/", "kernel/"] },
  { id: "edit_remote", spans: ["edit.remote_seen"], files: ["sync/", "host/"] },
  { id: "table100k", spans: ["records.open"], files: ["modules/records/", "client/"] },
  { id: "sync_snapshot", spans: ["sync.snapshot"], files: ["sync/", "kernel/"] },
  { id: "authorize", spans: ["authz.dur"], files: ["kernel/", "modules/access/"] },
  { id: "server_write", spans: ["cap.commit"], files: ["host/", "kernel/"] },
  { id: "engine_pool", spans: ["engine.acquire"], files: ["modules/engine/", "agent/"] },
  { id: "stream_render", spans: ["frame"], files: ["client/", "ui/", "modules/chat/"] },
  { id: "layout_shift", spans: ["layout-shift"], files: ["ui/"] },
  { id: "prefetch", spans: ["nav.prefetch_hit"], files: ["ui/", "client/"] },
  { id: "connection_count", spans: ["ws.connections"], files: ["perf/harness/headless.ts", "client/", "host/", "sync/"] },
  { id: "console_speed", spans: ["spans"], files: ["perf/", "manifests/console-views.ts"] },
];

export function budgetProbeCatalog(): Probe[] {
  return CATALOG.map((p) => ({ id: p.id, spans: [...p.spans], files: [...p.files] }));
}

function norm(file: string): string {
  return file.replace(/\\/g, "/").replace(/^\.\//, "");
}

/** A changed path hits a probe file entry when it is that path or lives under it. */
export function fileHits(file: string, prefix: string): boolean {
  const f = norm(file);
  const p = norm(prefix);
  if (f === p) return true;
  const dir = p.endsWith("/") ? p : `${p}/`;
  return f.startsWith(dir);
}

function closure(start: string, edges: Map<string, string[]>): string[] {
  const seen = new Set<string>();
  const q = [start];
  while (q.length) {
    const f = q.pop();
    if (f === undefined) break;
    for (const n of edges.get(f) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      q.push(n);
    }
  }
  return [...seen];
}

function reverse(fwd: Map<string, string[]>): Map<string, string[]> {
  const rev = new Map<string, string[]>();
  for (const [from, tos] of fwd) {
    for (const to of tos) {
      const list = rev.get(to) ?? [];
      list.push(from);
      rev.set(to, list);
    }
  }
  return rev;
}

/**
 * Probe ids touched by changed files.
 * `forward` is file to the files it imports. A change hits a probe when the file,
 * anything it imports, or anything that imports it (transitive) matches the probe's files.
 */
export function affectedProbeIds(changed: string[], probes: Probe[], forward?: Map<string, string[]>): string[] {
  const rev = forward ? reverse(forward) : undefined;
  const universe = new Set<string>();
  for (const raw of changed) {
    const f = norm(raw);
    universe.add(f);
    if (forward) for (const x of closure(f, forward)) universe.add(x);
    if (rev) for (const x of closure(f, rev)) universe.add(x);
  }
  const hit: string[] = [];
  for (const probe of probes) {
    const files = probe.files ?? [];
    if ([...universe].some((f) => files.some((p) => fileHits(f, p)))) hit.push(probe.id);
  }
  return [...new Set(hit)].sort();
}

/** Full set on main and tags. Every other ref is the fast lane. */
export function isFullLane(ref: string): boolean {
  const r = ref.trim().replace(/^origin\//, "");
  return r === "main" || r === "refs/heads/main" || r.startsWith("refs/tags/") || r.startsWith("tags/");
}

/** Fast lane: budget rows whose probe ids the change hits. budgets.json and the probe index select every row. */
export function selectRows(opts: { ref: string; changed: string[]; budgets: Budget[]; probes: Probe[]; forward?: Map<string, string[]> }): Budget[] {
  if (isFullLane(opts.ref)) return opts.budgets;
  const changed = opts.changed.map(norm);
  if (changed.some((f) => f === "perf/budgets.json" || f === PROBES_OUT)) return opts.budgets;
  const ids = new Set(affectedProbeIds(changed, opts.probes, opts.forward));
  return opts.budgets.filter((b) => ids.has(b.id));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) out[k] = sortKeys(o[k]);
    return out;
  }
  return v;
}

export function readScreenProbes(root: string): Probe[] {
  const raw = JSON.parse(fs.readFileSync(path.join(root, SCREEN_PROBES), "utf8")) as { probes?: Probe[] };
  if (!raw.probes || !Array.isArray(raw.probes)) throw new Error(`${SCREEN_PROBES} has no probes array`);
  return raw.probes.map((p, i) => {
    if (!p || typeof p.id !== "string" || !p.id) throw new Error(`${SCREEN_PROBES} probes[${i}] needs id`);
    return p;
  });
}

/** Screen probes plus one probe per budget id. Budget entries win on id collision. */
export function mergeProbes(screen: Probe[], budget: Probe[]): Probe[] {
  const byId = new Map<string, Probe>();
  for (const p of screen) byId.set(p.id, p);
  for (const p of budget) byId.set(p.id, p);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Generator for perf/generated/probes.json. Call this instead of editing the file. */
export function refreshProbes(root = REPO_ROOT): Probe[] {
  const merged = mergeProbes(readScreenProbes(root), budgetProbeCatalog());
  const file = path.join(root, PROBES_OUT);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(sortKeys({ probes: merged }), null, 2)}\n`);
  return merged;
}

export function readProbeIndex(root = REPO_ROOT): Probe[] {
  const raw = JSON.parse(fs.readFileSync(path.join(root, PROBES_OUT), "utf8")) as { probes?: Probe[] };
  if (!raw.probes || !Array.isArray(raw.probes)) throw new Error(`${PROBES_OUT} has no probes array`);
  return raw.probes;
}
