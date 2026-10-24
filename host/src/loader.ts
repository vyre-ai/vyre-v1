// (host/tests/loader.* import this file)
// The module loader (ARCH 4.4, 12.4). At boot it reads the frozen module list (host/modules.json) and the merged registry, checks they agree, loads each module's handlers
// (generated stub-impl while the module is `status:'stub'` in host/modules.json, its own impl once `live`), indexes the route table, and builds the per-call services (ctx.db scoped to the module, ctx.http limited to its connector's domains).
// Only the host builds a ctx (boundary B2); modules never see the raw database or fetch.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { fail } from "./routes/errors.ts";
import { indexRoutes } from "./routes/table.ts";
import type { RouteRec } from "./routes/table.ts";
import { scopedDb } from "./ctx/db.ts";
import type { RawDb } from "./ctx/db.ts";
import { guardedFetch } from "./ctx/http.ts";
import type { FetchLike } from "./ctx/http.ts";
import type { Handler, InvokeDeps } from "./invoke.ts";
import type { SeamSetters } from "./seams/index.ts";

export interface ModuleListEntry { id: string; owner: string; status: string }
export interface ModuleList { modules: ModuleListEntry[] }
type Owned = { module: string };
export interface RegistryLike {
  modules: { id: string; owner: string; kind?: string }[];
  capabilities: (Owned & { name: string; v: number })[];
  connectors?: (Owned & { domains?: string[] })[];
}
export type HandlerMap = Record<string, Handler>;
export type Importer = (moduleId: string, kind: "stub" | "live") => Promise<HandlerMap>;
/** What a module's impl.ts exports as `hostSeams`: the setters through which the host hands it a connector seam (Google, Microsoft, IMAP). Undefined when the module has none or no impl. */
export type SeamImporter = (moduleId: string) => Promise<SeamSetters | undefined>;

export interface LoaderOptions {
  registry: RegistryLike;
  modulesJson: ModuleList;
  routes: readonly RouteRec[];
  importer: Importer;
  /** collects each module impl's `hostSeams` (ruling 31); omitted: none */
  seamImporter?: SeamImporter;
  /** the module database; omit and ctx.db refuses every call */
  db?: RawDb;
  fetch?: FetchLike;
}

export interface LoadedHost {
  handler: InvokeDeps["handler"];
  services: NonNullable<InvokeDeps["services"]>;
  match: (method: string, path: string) => RouteRec | undefined;
  /** module id to what the host serves for it */
  serving: ReadonlyMap<string, "stub" | "live">;
  stubModules(): string[];
  /** every setter the modules exported as hostSeams, merged; the daemon wires the seams through them */
  hostSeams: SeamSetters;
}

/** Where 0.6-style files live: generated/modules/<id>/stub-impl.ts for a stub, modules/<id>/impl.ts once live. */
export function fileImporter(root: string): Importer {
  return async (id, kind) => {
    const rel = kind === "stub" ? `generated/modules/${id}/stub-impl.ts` : `modules/${id}/impl.ts`;
    const m = (await import(pathToFileURL(`${root.replace(/\/$/, "")}/${rel}`).href)) as { handlers?: HandlerMap };
    if (!m.handlers) throw new Error(`${rel} exports no handlers`);
    return m.handlers;
  };
}

/** modules/<id>/impl.ts `hostSeams`. A module with no impl file, or no such export, has no seam; a file that fails to load is skipped here (a live module's failure is already reported by the handlers import). */
export function fileSeamImporter(root: string): SeamImporter {
  return async (id) => {
    try {
      const m = (await import(pathToFileURL(`${root.replace(/\/$/, "")}/modules/${id}/impl.ts`).href)) as { hostSeams?: SeamSetters };
      return m.hostSeams;
    } catch { return undefined; }
  };
}

export const readModuleList = (file: string): ModuleList => JSON.parse(readFileSync(file, "utf8")) as ModuleList;

export async function loadHost(o: LoaderOptions): Promise<LoadedHost> {
  const problems: string[] = [];
  // 1 the frozen list and the registry agree
  const listed = new Map(o.modulesJson.modules.map((m) => [m.id, m]));
  for (const m of o.registry.modules) {
    if (m.kind !== undefined && m.kind !== "module") continue;   // host/modules.json freezes the 72 modules; connectors and kits are not in it
    const l = listed.get(m.id);
    if (!l) problems.push(`module ${m.id} is in the registry but not in host/modules.json`);
    else if (l.owner !== m.owner) problems.push(`module ${m.id}: owner ${m.owner} in the registry, ${l.owner} in host/modules.json`);
  }
  const regIds = new Set(o.registry.modules.map((m) => m.id));
  for (const id of listed.keys()) if (!regIds.has(id)) problems.push(`host/modules.json lists ${id}, which has no manifest`);
  // 2 every route names a capability that exists
  const caps = new Map(o.registry.capabilities.map((c) => [`${c.name}@${c.v}`, c]));
  for (const r of o.routes) if (!caps.has(`${r.cap}@${r.v}`)) problems.push(`route ${r.method} ${r.path} names unknown capability ${r.cap}@${r.v}`);
  const match = indexRoutes(o.routes);

  // 3 handlers, by the status in host/modules.json (ruling 25: runtime state, not contract)
  const handlers = new Map<string, Handler>();
  const serving = new Map<string, "stub" | "live">();
  for (const m of o.registry.modules) {
    if (!o.registry.capabilities.some((c) => c.module === m.id)) continue;   // a kit has no capabilities and nothing to load
    const kind = listed.get(m.id)?.status === "live" ? "live" : "stub";   // a kit is not listed and has no capabilities, so it never gets here
    serving.set(m.id, kind);
    let map: HandlerMap;
    try { map = await o.importer(m.id, kind); } catch (e) { problems.push(`module ${m.id}: cannot load ${kind} handlers (${e instanceof Error ? e.message : String(e)})`); continue; }
    for (const c of o.registry.capabilities) {
      if (c.module !== m.id) continue;
      const h = map[c.name];
      if (h) handlers.set(`${c.name}@${c.v}`, h);
      else problems.push(`module ${m.id} (${kind}) has no handler for ${c.name}`);
    }
  }
  // 3b host seams: each module impl's exported setters, merged (two modules offering the same setter is a boot error)
  const hostSeams: SeamSetters = {};
  if (o.seamImporter) {
    for (const m of o.registry.modules) {
      if (!o.registry.capabilities.some((c) => c.module === m.id)) continue;
      const s = await o.seamImporter(m.id);
      for (const [k, fn] of Object.entries(s ?? {})) {
        if (typeof fn !== "function") continue;
        if ((hostSeams as Record<string, unknown>)[k]) problems.push(`module ${m.id} offers ${k}, which another module already offers`);
        (hostSeams as Record<string, unknown>)[k] = fn;
      }
    }
  }
  if (problems.length) throw new Error(`host boot refused:\n- ${problems.join("\n- ")}`);

  // 4 per-module egress lists
  const domains = new Map<string, string[]>();
  for (const c of o.registry.connectors ?? []) domains.set(c.module, [...(domains.get(c.module) ?? []), ...(c.domains ?? [])]);
  const capModule = new Map([...caps].map(([k, c]) => [k, c.module]));
  const refuse = (what: string) => (): never => { throw fail("internal.not_implemented", "0".repeat(32), { details: { service: what } }); };

  return {
    handler: (cap, v) => handlers.get(`${cap}@${v}`),
    services: (seed, cap) => {
      const mod = capModule.get(`${cap.name}@${cap.v}`) ?? "";
      const traceId = seed.trace?.traceId ?? "0".repeat(32);
      return {
        db: o.db ? scopedDb(mod, o.db, traceId) : { all: refuse("db"), run: refuse("db") },
        http: guardedFetch(domains.get(mod) ?? [], traceId, o.fetch),
      };
    },
    match,
    serving,
    hostSeams,
    stubModules: () => [...serving].filter(([, k]) => k === "stub").map(([id]) => id),
  };
}
