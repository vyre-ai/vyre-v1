// Server-side view of the sync entity catalog (ARCH 5.3 rule = entityDef(c.entity).sync, 5.11 profiles).
// generated/ is outside the layer packages, so the file is read as text and parsed, as the replica catalog does.
// A record type the generated catalog does not list (a type the Space defined itself) gets DEFAULT_ENTITY: everyone mirrors it, a phone takes a window.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DeviceClass } from "../../protocol.ts";

export type ProfileMode = "all" | "window" | "none";
export const LABEL_RANKS = { public: 0, internal: 1, confidential: 2, restricted: 3 } as const;
/** Restricted is never mirrored to any device class (5.11); a phone setting can lower the ceiling, never raise it. */
export const DEVICE_CEILING: Readonly<Record<DeviceClass, number>> = Object.freeze({ desktop: LABEL_RANKS.confidential, web: LABEL_RANKS.confidential, phone: LABEL_RANKS.confidential });

export interface ServerEntity {
  key: string;
  table: string;
  kind: "entity" | "record_type";
  /** The access resource type scopeFor is asked about. */
  resource: string;
  ownerField: string | null;
  profile: Readonly<Record<DeviceClass, ProfileMode>>;
  window: { days?: number; recentCount?: number; starred?: boolean };
  /** Null when the entity sets no ceiling of its own. */
  maxLabel: number | null;
  fieldLabels: Readonly<Record<string, number>>;
  protectedFields: readonly string[];
}

interface Raw {
  kind?: string; key?: string; table?: string;
  acl?: { resource?: string; ownerField?: string | null };
  sync?: { profile?: Partial<Record<DeviceClass, string>>; window?: { days?: number; recentCount?: number; starred?: boolean }; maxLabel?: string; protectedFields?: string[] };
  fields?: Record<string, { label?: string | null }>;
}

const MODES = new Set(["all", "window", "none"]);
const rank = (v: string | null | undefined): number | null => (v === "public" || v === "internal" || v === "confidential" || v === "restricted" ? LABEL_RANKS[v] : null);

export const DEFAULT_ENTITY = (key: string): ServerEntity => ({
  key, table: `rt_${key}`, kind: "record_type", resource: "record", ownerField: null,
  profile: { desktop: "all", web: "all", phone: "window" }, window: {}, maxLabel: null, fieldLabels: {}, protectedFields: [],
});

function entityOf(r: Raw): ServerEntity {
  if (!r.key || !r.table || (r.kind !== "entity" && r.kind !== "record_type")) throw new Error("sync catalog: an entity needs kind, key and table");
  const p = r.sync?.profile ?? {};
  const mode = (c: DeviceClass): ProfileMode => {
    const v = p[c];
    if (v === undefined || !MODES.has(v)) throw new Error(`sync catalog: ${r.key} profile ${c} is not all, window or none`);
    return v as ProfileMode;
  };
  const fieldLabels: Record<string, number> = {};
  for (const [f, def] of Object.entries(r.fields ?? {})) { const n = rank(def?.label ?? null); if (n !== null) fieldLabels[f] = n; }
  const w = r.sync?.window ?? {};
  return {
    key: r.key, table: r.table, kind: r.kind, resource: r.acl?.resource ?? "record", ownerField: r.acl?.ownerField ?? null,
    profile: { desktop: mode("desktop"), phone: mode("phone"), web: mode("web") },
    window: { ...(typeof w.days === "number" ? { days: w.days } : {}), ...(typeof w.recentCount === "number" ? { recentCount: w.recentCount } : {}), ...(w.starred === true ? { starred: true } : {}) },
    maxLabel: rank(r.sync?.maxLabel ?? null), fieldLabels, protectedFields: r.sync?.protectedFields ?? [],
  };
}

/** Parse the `syncEntities` array literal out of generated/sync/entities.ts. */
export function parseCatalog(text: string): Map<string, ServerEntity> {
  const mark = text.indexOf("export const syncEntities");
  const eq = mark < 0 ? -1 : text.indexOf("= [", mark);
  if (eq < 0) throw new Error("sync catalog: syncEntities is missing");
  const next = text.indexOf("\nexport ", eq + 3);
  const end = text.lastIndexOf("];", next === -1 ? text.length : next);
  if (end < eq) throw new Error("sync catalog: syncEntities is not an array literal");
  const parsed = JSON.parse(text.slice(eq + 2, end + 1)) as unknown;
  if (!Array.isArray(parsed) || !parsed.length) throw new Error("sync catalog is empty");
  const out = new Map<string, ServerEntity>();
  for (const row of parsed) { const e = entityOf(row as Raw); out.set(e.key, e); }
  return out;
}

export interface Catalog {
  /** The entity config, or the default for a Space-defined record type. */
  get(key: string): ServerEntity;
  known(): readonly ServerEntity[];
  /** Keys whose profile for this class is `none`: never sent, never snapshotted. */
  excluded(deviceClass: DeviceClass): string[];
}

export function makeCatalog(entities: Map<string, ServerEntity>): Catalog {
  return {
    get: (key) => entities.get(key) ?? DEFAULT_ENTITY(key),
    known: () => [...entities.values()],
    excluded: (c) => [...entities.values()].filter((e) => e.profile[c] === "none").map((e) => e.key),
  };
}

const GENERATED = fileURLToPath(new URL("../../../../generated/sync/entities.ts", import.meta.url));
let cached: Catalog | null = null;
/** The generated catalog, read once. Pass a file to read another (tests). */
export function loadCatalog(file?: string): Catalog {
  if (file !== undefined) return makeCatalog(parseCatalog(readFileSync(file, "utf8")));
  cached ??= makeCatalog(parseCatalog(readFileSync(GENERATED, "utf8")));
  return cached;
}
