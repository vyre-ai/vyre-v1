// What HubSpot pages mean to a synced type (spec 2.10): rows out of a list page, the pull into a local store, and the push request for a local change.
// The sync engine in modules/sources owns links, the outbox and conflicts; this file holds the HubSpot side of the bargain and nothing else, so it can be replayed on recorded pages.
import type { SyncedTypeDef } from "./compile.ts";

export interface RemoteRow { id: string; data: Record<string, unknown>; updatedAt: string; archived: boolean }
export interface Page { rows: RemoteRow[]; next?: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export class PageError extends Error {
  constructor(message: string) { super(message); this.name = "PageError"; }
}

/** A list answer from /crm/v3/objects/<type>: results with a properties bag, and paging.next.after when more follow. */
export function readPage(body: unknown): Page {
  if (!isObj(body) || !Array.isArray(body["results"])) throw new PageError("HubSpot did not answer with a list of results.");
  const rows = body["results"].map((r, i): RemoteRow => {
    if (!isObj(r) || typeof r["id"] !== "string" || r["id"] === "" || !isObj(r["properties"])) throw new PageError(`Result ${i} has no id or no properties.`);
    const updated = r["updatedAt"] ?? r["properties"]["hs_lastmodifieddate"];
    return { id: r["id"], data: { ...r["properties"] }, updatedAt: typeof updated === "string" ? updated : "", archived: r["archived"] === true };
  });
  const paging = body["paging"];
  const after = isObj(paging) && isObj(paging["next"]) ? paging["next"]["after"] : undefined;
  return { rows, ...(typeof after === "string" && after !== "" ? { next: after } : {}) };
}

/** HubSpot sends empty properties as null or "". Both mean nothing here. */
const clean = (v: unknown): unknown => (v === undefined || v === null || v === "" ? null : v);

/** The local values a remote row gives: only fields whose direction lets them be pulled. */
export function toLocal(t: SyncedTypeDef, row: RemoteRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of t.fields) if (f.dir === "pull" || f.dir === "both") out[f.key] = clean(row.data[f.remote]);
  return out;
}

/** Emails and domains match without regard to case or surrounding space. */
const norm = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : v === null || v === undefined ? "" : String(v));
export const matchKey = (t: SyncedTypeDef, values: Record<string, unknown>): string | undefined => {
  const parts = t.match.map((k) => norm(values[k]));
  return parts.some((p) => p === "") ? undefined : parts.join("\u0000");
};

export interface LocalRecord { id: string; data: Record<string, unknown> }
export interface LocalStore {
  all(): LocalRecord[];
  create(data: Record<string, unknown>, remoteId: string): LocalRecord;
  update(id: string, patch: Record<string, unknown>): void;
}
export interface PullReport { created: number; updated: number; unchanged: number; linked: number; removedAtSource: string[]; skipped: { remoteId: string; reason: string }[] }

/**
 * Pull rows into a local store. A row already linked by remote id updates that record; an unlinked row pairs with a local record by the match rule (first sync) or becomes a new record.
 * A row HubSpot has archived is reported, never deleted here: deletes stay off unless the type says otherwise, and the engine marks it "Removed at source".
 * Running the same page twice changes nothing.
 */
export function pullRows(t: SyncedTypeDef, rows: RemoteRow[], store: LocalStore, links: Map<string, string>): PullReport {
  const rep: PullReport = { created: 0, updated: 0, unchanged: 0, linked: 0, removedAtSource: [], skipped: [] };
  const byId = new Map(store.all().map((r) => [r.id, r]));
  const byMatch = new Map<string, LocalRecord[]>();
  for (const r of byId.values()) {
    const k = matchKey(t, r.data);
    if (k !== undefined) byMatch.set(k, [...(byMatch.get(k) ?? []), r]);
  }
  for (const row of rows) {
    if (row.archived) { rep.removedAtSource.push(row.id); continue; }
    const values = toLocal(t, row);
    let justLinked = false;
    let local = links.has(row.id) ? byId.get(links.get(row.id)!) : undefined;
    if (!local) {
      const k = matchKey(t, values);
      if (k === undefined) { rep.skipped.push({ remoteId: row.id, reason: `no ${t.match.join(" and ")} to match on` }); continue; }
      const hits = (byMatch.get(k) ?? []).filter((h) => ![...links.values()].includes(h.id));
      if (hits.length > 1) { rep.skipped.push({ remoteId: row.id, reason: `${hits.length} records share ${t.match.join(" and ")}: needs you` }); continue; }
      local = hits[0];
      if (local) { links.set(row.id, local.id); rep.linked++; justLinked = true; }
    }
    if (!local) {
      const made = store.create(values, row.id);
      links.set(row.id, made.id);
      byId.set(made.id, made);
      rep.created++;
      continue;
    }
    const patch: Record<string, unknown> = {};
    // A record that was just paired by the match rule keeps what it has where HubSpot is empty; a record already linked follows HubSpot, empty included.
    for (const [k, v] of Object.entries(values)) if (clean(local.data[k]) !== v && !(justLinked && v === null)) patch[k] = v;
    if (Object.keys(patch).length === 0) { rep.unchanged++; continue; }
    store.update(local.id, patch);
    local.data = { ...local.data, ...patch };
    rep.updated++;
  }
  return rep;
}

export interface PushRequest { action: string; input: { id?: string; properties: Record<string, unknown> }; fields: string[] }
export type PushPlan = { push: PushRequest } | { skip: string };

const ACTION: Record<string, { update: string; create: string }> = { contacts: { update: "update_contact", create: "create_contact" }, companies: { update: "update_company", create: "create_company" } };

/**
 * The HubSpot call for a local change. Only fields whose direction is push or both travel. A record with no HubSpot id is created there only when the type says
 * createAtSource (off by default). `replaced` is what HubSpot holds now for the fields about to change, kept so the push can be undone.
 */
export function planPush(t: SyncedTypeDef, change: { remoteId?: string; patch: Record<string, unknown>; remoteNow?: Record<string, unknown> }): PushPlan & { replaced?: Record<string, unknown> } {
  const names = ACTION[t.remote];
  if (!names) return { skip: `${t.remote} is not a HubSpot object this connector pushes` };
  const properties: Record<string, unknown> = {};
  const fields: string[] = [];
  const replaced: Record<string, unknown> = {};
  for (const f of t.fields) {
    if (f.dir !== "push" && f.dir !== "both") continue;
    if (!(f.key in change.patch)) continue;
    const v = change.patch[f.key];
    properties[f.remote] = v === null || v === undefined ? "" : v;
    fields.push(f.key);
    if (change.remoteNow) replaced[f.remote] = clean(change.remoteNow[f.remote]);
  }
  if (fields.length === 0) return { skip: "no field of this change is set to push" };
  if (!change.remoteId) {
    if (!t.createAtSource) return { skip: "create at source is off for this type" };
    return { push: { action: names.create, input: { properties }, fields } };
  }
  return { push: { action: names.update, input: { id: change.remoteId, properties }, fields }, ...(change.remoteNow ? { replaced } : {}) };
}
