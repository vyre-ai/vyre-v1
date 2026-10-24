// Sync entity catalog. Read as text from generated/sync/entities.ts and parsed. Not imported:
// generated/ is outside the layer packages, so a static import would fail the boundary check.
import { readFileSync } from "node:fs";
import { resolveEntities } from "./ddl.ts";
import { LABEL_RANK, ReplicaError } from "./types.ts";
import type { DeviceClass, EntityInfo, ProfileMode } from "./types.ts";

interface RawField { type?: string; label?: string | null }
interface RawEntity {
  kind?: string;
  key?: string;
  table?: string;
  acl?: { ownerField?: string | null };
  sync?: {
    profile?: { desktop?: string; phone?: string; web?: string };
    window?: { days?: number; starred?: boolean; recentCount?: number };
    maxLabel?: string;
  };
  fields?: Record<string, RawField>;
  fts?: string[];
}

const MODES = new Set<ProfileMode>(["all", "window", "none"]);

function mode(v: string | undefined, key: string, cls: string): ProfileMode {
  if (v && MODES.has(v as ProfileMode)) return v as ProfileMode;
  throw new ReplicaError("bad_catalog", `${key} profile ${cls} is not all, window or none`);
}

function labelRank(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (v === "public" || v === "internal" || v === "confidential" || v === "restricted") return LABEL_RANK[v];
  return null;
}

function entityOf(raw: RawEntity): EntityInfo {
  const key = raw.key;
  const table = raw.table;
  const profileRaw = raw.sync?.profile;
  if (raw.kind !== "entity" && raw.kind !== "record_type") throw new ReplicaError("bad_catalog", "entity kind is missing");
  if (!key || !table || !profileRaw) throw new ReplicaError("bad_catalog", "entity key, table or profile is missing");
  const fieldLabels: Record<string, number> = {};
  const datetimeFields: string[] = [];
  for (const [k, f] of Object.entries(raw.fields ?? {})) {
    if (!f) continue;
    const rank = labelRank(f.label ?? null);
    if (rank !== null) fieldLabels[k] = rank;
    if (f.type === "datetime" || f.type === "date") datetimeFields.push(k);
  }
  const window = raw.sync?.window ?? {};
  const maxLabel = labelRank(raw.sync?.maxLabel ?? null);
  const classes: DeviceClass[] = ["desktop", "phone", "web"];
  const profile = {} as Record<DeviceClass, ProfileMode>;
  for (const cls of classes) profile[cls] = mode(profileRaw[cls], key, cls);
  return {
    kind: raw.kind,
    key,
    table,
    profile,
    window: {
      ...(typeof window.days === "number" ? { days: window.days } : {}),
      ...(window.starred === true ? { starred: true } : {}),
      ...(typeof window.recentCount === "number" ? { recentCount: window.recentCount } : {}),
    },
    maxLabel,
    fts: Array.isArray(raw.fts) ? raw.fts.filter((f) => typeof f === "string") : [],
    ownerField: raw.acl?.ownerField ?? null,
    fieldLabels,
    datetimeFields,
  };
}

let cached: { path: string; byKey: Map<string, EntityInfo> } | null = null;

export function loadCatalog(): Map<string, EntityInfo> {
  const file = resolveEntities();
  if (cached && cached.path === file) return cached.byKey;
  const text = readFileSync(file, "utf8");
  const mark = text.indexOf("export const syncEntities");
  if (mark < 0) throw new ReplicaError("bad_catalog", "syncEntities is missing");
  const eq = text.indexOf("= [", mark);
  const nextExport = eq < 0 ? -1 : text.indexOf("\nexport ", eq + 3);
  const end = eq < 0 ? -1 : text.lastIndexOf("];", nextExport === -1 ? text.length : nextExport);
  if (eq < 0 || end < eq) throw new ReplicaError("bad_catalog", "syncEntities is not a JSON array");
  const parsed = JSON.parse(text.slice(eq + 2, end + 1)) as unknown;
  if (!Array.isArray(parsed)) throw new ReplicaError("bad_catalog", "syncEntities is not an array");
  const byKey = new Map<string, EntityInfo>();
  for (const row of parsed) {
    const entity = entityOf(row as RawEntity);
    byKey.set(entity.key, entity);
  }
  if (!byKey.size) throw new ReplicaError("bad_catalog", "sync catalog is empty");
  cached = { path: file, byKey };
  return byKey;
}
