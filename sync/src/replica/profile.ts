// Replica profiles (ARCH 5.11). Desktop and web mirror up to Confidential. Phone uses the
// entity window (messages 90 days, file meta recent and starred, records the person owns
// or follows, plus starred). Restricted is never mirrored on any class.
import { DEVICE_LABEL_CEILING, LABEL_RANK, RESTRICTED_RANK } from "./types.ts";
import type { DeviceClass, EntityInfo, LabelName, SqlRow, WriteOrigin } from "./types.ts";

export interface AdmitRequest {
  deviceClass: DeviceClass;
  phoneCeiling: LabelName;
  entity: EntityInfo;
  rowLabel: number | null;
  at: number | null;
  now: number;
  starred: boolean;
  follows: boolean;
  owner: string | null;
  personId: string | null;
  origin: WriteOrigin;
  exists: boolean;
}

export type AdmitDecision = { ok: true } | { ok: false; reason: "profile_none" | "restricted" | "above_label" | "outside_window" | "not_owned" };

const DAY_MS = 86_400_000;
const TIME_FIELDS = ["createdAt", "created_at", "at", "sentAt", "startsAt", "learnedAt", "updated_at", "updatedAt", "editedAt"];

export function labelRankOf(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= RESTRICTED_RANK) return v;
  if (v === "public" || v === "internal" || v === "confidential" || v === "restricted") return LABEL_RANK[v];
  return null;
}

/** The highest rank this device may store. Phone policy can only lower the ceiling. */
export function ceilingRank(deviceClass: DeviceClass, phoneCeiling: LabelName, maxLabel: number | null): number {
  let cap = DEVICE_LABEL_CEILING[deviceClass];
  if (deviceClass === "phone") cap = Math.min(cap, LABEL_RANK[phoneCeiling]);
  if (maxLabel !== null) cap = Math.min(cap, maxLabel);
  return cap;
}

export function rowTime(columnNames: ReadonlySet<string>, datetimeFields: readonly string[], row: SqlRow): number | null {
  const seen = new Set<string>();
  const names = [...TIME_FIELDS, ...datetimeFields];
  for (const name of names) {
    if (seen.has(name) || !columnNames.has(name)) continue;
    seen.add(name);
    const v = row[name];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "bigint") return Number(v);
  }
  return null;
}

export function admit(req: AdmitRequest): AdmitDecision {
  const mode = req.entity.profile[req.deviceClass];
  if (mode === "none") return { ok: false, reason: "profile_none" };
  if (req.rowLabel !== null && req.rowLabel >= RESTRICTED_RANK) return { ok: false, reason: "restricted" };
  const cap = ceilingRank(req.deviceClass, req.phoneCeiling, req.entity.maxLabel);
  if (req.rowLabel !== null && req.rowLabel > cap) return { ok: false, reason: "above_label" };

  if (mode === "window") {
    const days = req.entity.window.days;
    const keepStarred = req.starred && req.entity.window.starred === true;
    if (days !== undefined && !keepStarred && !(req.origin === "local" && req.exists)) {
      if (req.at === null) {
        if (req.origin === "mirror") return { ok: false, reason: "outside_window" };
      } else if (req.now - req.at > days * DAY_MS) {
        return { ok: false, reason: "outside_window" };
      }
    }
    if (req.deviceClass === "phone" && req.entity.kind === "record_type" && req.personId && !(req.origin === "local" && req.exists)) {
      const owned = req.owner !== null && req.owner === req.personId;
      if (!owned && !req.follows && !req.starred) return { ok: false, reason: "not_owned" };
    }
  }
  return { ok: true };
}

/** Field keys whose label is above the device ceiling, or Restricted. Those values are not stored. */
export function fieldsAboveCeiling(entity: EntityInfo, deviceClass: DeviceClass, phoneCeiling: LabelName): string[] {
  const cap = ceilingRank(deviceClass, phoneCeiling, entity.maxLabel);
  const out: string[] = [];
  for (const [key, rank] of Object.entries(entity.fieldLabels)) {
    if (rank === undefined) continue;
    if (rank >= RESTRICTED_RANK || rank > cap) out.push(key);
  }
  return out;
}
