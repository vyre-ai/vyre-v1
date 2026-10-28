// A preview never runs module handlers: even a declared read may issue a secret,
// initialize a Personal root, or create an export. This finite projection is the
// complete preview read surface; every other capability and transport refuses it.
import { sha256Hex } from "../../../kernel/src/log/hash.ts";
import { authorize, type AccessSnapshot } from "../../../kernel/src/authorize/index.ts";
import type { Store, StoredRecord } from "../../../kernel/src/store/types.ts";
import { fail } from "../routes/errors.ts";

export const PREVIEW_READ_CAPS = ["records.get", "records.query"] as const;
export interface PreviewIdentity { space: string; requester: string; target: string; sessionId: string; device: string; expiresAt: number }
export interface PreviewSource { person: string; sessionId: string; device: string }
interface Entry extends PreviewIdentity { cursors: Map<string, { type: string; cursor: string }> }
export interface PreviewPorts {
  space: string;
  snapshot(): AccessSnapshot;
  sourceLive(source: PreviewSource): boolean;
  store(): Store;
  now(): number;
}
const random = (): string => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");

export function createViewAs(ports: PreviewPorts) {
  const entries = new Map<string, Entry>();
  const deny = (trace: string): never => { throw fail("permission.no_grant", trace, { message: "This read-only preview is unavailable or no longer authorized." }); };
  function live(entry: PreviewIdentity, trace: string): AccessSnapshot {
    const snap = ports.snapshot();
    if (entry.space !== ports.space || entry.expiresAt <= ports.now() || !ports.sourceLive({ person: entry.requester, sessionId: entry.sessionId, device: entry.device }) || snap.principal(entry.target)?.kind !== "person" || snap.principal(entry.target)?.status !== "active") deny(trace);
    const decision = authorize(snap, { principal: entry.requester, action: { perm: "access.manage", level: "view" }, resource: { type: "space", id: ports.space }, now: ports.now() });
    if (decision.effect !== "allow") deny(trace);
    return snap;
  }
  function get(token: string, trace: string): Entry {
    const entry = entries.get(sha256Hex(token));
    if (!entry) return deny(trace);
    try { live(entry, trace); } catch (error) { entries.delete(sha256Hex(token)); throw error; }
    return entry;
  }
  // Only ordinary Space Records are in this facade. Personal roots, credentials,
  // artifacts and objects whose ancestry cannot be established fail closed.
  function shared(snap: AccessSnapshot, id: string): boolean {
    const seen = new Set<string>();
    let current: string | null = id;
    while (current && !seen.has(current)) {
      if (current === ports.space) return snap.resource(current)?.type === "space";
      seen.add(current);
      const row = snap.resource(current);
      if (!row || !["record", "record_type"].includes(row.type)) return false;
      current = row.parent_id;
    }
    return false;
  }
  function project(entry: Entry, row: StoredRecord, trace: string) {
    const snap = live(entry, trace), resource = snap.resource(row.id);
    if (!resource || resource.type !== "record" || !shared(snap, row.id) || row.deleted_at !== undefined) return null;
    const decisions = [entry.requester, entry.target].map(principal => authorize(snap, { principal, action: { perm: null, level: "view" }, resource: { type: "record", id: row.id }, row: { ...row.data, id: row.id, owner_id: resource.owner_id }, now: ports.now() }));
    if (decisions.some(d => d.effect !== "allow")) return null;
    const hidden = new Set(decisions.flatMap(d => [...(d.scope?.hiddenFields ?? [])]));
    const ceiling = Math.min(...decisions.map(d => d.scope?.labelCeiling ?? -1));
    const fields = Object.fromEntries(Object.entries(row.data).filter(([field]) => !hidden.has(field) && snap.fieldLabel(row.type, field) <= ceiling && snap.fieldLabel("record", field) <= ceiling));
    return { id: row.id, type: row.type, version: row.version, label: resource.label, fields, createdAt: row.created_at, updatedAt: row.updated_at, holds: resource.holds };
  }
  return {
    issue(source: PreviewSource, target: string, trace: string) {
      if (!source.sessionId || source.person === target) return deny(trace);
      const entry: Entry = { space: ports.space, requester: source.person, target, sessionId: source.sessionId, device: source.device, expiresAt: ports.now() + 600_000, cursors: new Map() };
      live(entry, trace);
      // Bound memory and discard expired tokens, without persisting bearer values.
      for (const [hash, value] of entries) if (value.expiresAt <= ports.now()) entries.delete(hash);
      if (entries.size >= 256) throw fail("validation.precondition_failed", trace, { message: "Close an existing preview before opening another." });
      const previewToken = `vas_${random()}`;
      entries.set(sha256Hex(previewToken), entry);
      return { previewToken, expiresAt: entry.expiresAt };
    },
    resolve(token: string): PreviewIdentity | null {
      try { const { cursors: _cursors, ...identity } = get(token, ""); return identity; } catch { return null; }
    },
    check(token: string, trace: string): void { get(token, trace); },
    async read(token: string, cap: string, raw: unknown, trace: string) {
      const entry = get(token, trace);
      if (!(PREVIEW_READ_CAPS as readonly string[]).includes(cap)) return deny(trace);
      const input = raw as Record<string, unknown>;
      if (!input || typeof input !== "object" || typeof input["type"] !== "string") throw fail("validation.bad_input", trace);
      const type = input["type"];
      if (cap === "records.get") {
        if (Object.keys(input).some(key => !["type", "recordId"].includes(key)) || typeof input["recordId"] !== "string") throw fail("validation.bad_input", trace);
        const row = await ports.store().get(type, input["recordId"]);
        const record = row && project(entry, row, trace);
        if (!record) return deny(trace);
        return { finish: () => { const latest = project(entry, row, trace); if (!latest) return deny(trace); return { record: latest }; } };
      }
      if (Object.keys(input).some(key => !["type", "limit", "cursor"].includes(key))) throw fail("validation.bad_input", trace, { message: "Preview queries support type, limit and cursor only." });
      const limit = input["limit"] ?? 25;
      if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 50) throw fail("validation.bad_input", trace);
      let cursor: string | undefined;
      if (input["cursor"] !== undefined) {
        const saved = typeof input["cursor"] === "string" ? entry.cursors.get(input["cursor"]) : undefined;
        if (!saved || saved.type !== type) throw fail("validation.bad_input", trace);
        cursor = saved.cursor;
      }
      const rows: StoredRecord[] = [];
      // Page one row at a time so the opaque continuation never drops a visible
      // row, or leaks a hidden row's cursor/field values. No unfiltered total.
      for (let scanned = 0; scanned < 500 && rows.length < limit; scanned++) {
        const page = await ports.store().query(type, { page: { limit: 1, ...(cursor ? { cursor } : {}) } });
        live(entry, trace);
        const row = page.rows[0];
        cursor = page.next_cursor;
        if (row && project(entry, row, trace)) rows.push(row);
        if (!cursor) break;
      }
      // Redact again after all awaited reads: permission changes during paging
      // cannot release an earlier page's now-revoked row or hidden field.
      let next: string | undefined;
      if (cursor) {
        if (entry.cursors.size >= 100) entry.cursors.delete(entry.cursors.keys().next().value!);
        next = random(); entry.cursors.set(next, { type, cursor });
      }
      return { finish: () => { live(entry, trace); return { rows: rows.map(row => project(entry, row, trace)).filter(row => row !== null), ...(next ? { next } : {}) }; } };
    },
  };
}
