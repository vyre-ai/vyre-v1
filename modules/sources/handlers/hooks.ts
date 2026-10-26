// sources: the one inbound pipeline (spec 2.10, ARCH 8 "Common pipeline") and the source, delivery and linking capabilities around it.
// /hooks/<source> -> sources.ingest: find the source, verify the signature (fail closed), parse, normalise through the mapping, dedupe on the provider id (source_seen),
// upsert through records.bulk_upsert, then the shared linking step: a sure match is linked, unsure matches wait in Needs you. Records are read and written only through
// the capability API (ctx.call), never through another module's code. A repeated provider id is dropped; a failed delivery keeps its body so it can be replayed.
import type { Tx } from "../../../kernel/src/store/projection.ts";
import { DAY, ensureTables, mappingProblem, mintShort, nowOf, normalise, parseBody, refuse, same, verifyDelivery } from "../projections.ts";
import type { DeliveryStatus, Mapping, SourceState, SourcesCtx, SourcesDeps, Verify } from "../projections.ts";

export interface SourceRow {
  sourceId: string; key: string; title: string; connector?: string; connectionId?: string; path: string; verify: Verify; type: string; state: SourceState;
  lastReceivedAt?: number; received24h: number; failed24h: number; mapping?: Mapping;
}
export interface DeliveryRow { deliveryId: string; sourceId: string; receivedAt: number; providerId?: string; status: DeliveryStatus; error?: string; recordIds: string[] }
export interface Candidate { recordId: string; type: string; score: number; reasons: string[] }
export type IngestOut = { status: "accepted" | "duplicate" | "rejected" | "failed"; deliveryId?: string; recordIds: string[]; reason?: string };

export interface HooksHandlers {
  "sources.list"(ctx: SourcesCtx, input: { type?: string; state?: SourceState; cursor?: string; limit?: number }): Promise<{ sources: SourceRow[]; next?: string; total?: number }>;
  "sources.get"(ctx: SourcesCtx, input: { sourceId: string }): Promise<{ source: SourceRow }>;
  "sources.kinds"(ctx: SourcesCtx, input: Record<string, never>): Promise<{ kinds: { key: string; title: string; connector?: string; verify: Verify; needsTeamSpace: boolean }[] }>;
  "sources.create"(ctx: SourcesCtx, input: { connector: string; title: string; type: string; mapping: Mapping; verify?: Verify; secretName?: string; connectionId?: string }): Promise<{ source: SourceRow }>;
  "sources.update"(ctx: SourcesCtx, input: { sourceId: string; title?: string; type?: string; mapping?: Mapping; verify?: Verify }): Promise<{ source: SourceRow }>;
  "sources.set_secret"(ctx: SourcesCtx, input: { sourceId: string; secretName: string }): Promise<{ ok: boolean }>;
  "sources.pause"(ctx: SourcesCtx, input: { sourceId: string; reason?: string }): Promise<{ ok: boolean }>;
  "sources.resume"(ctx: SourcesCtx, input: { sourceId: string }): Promise<{ ok: boolean }>;
  "sources.delete"(ctx: SourcesCtx, input: { sourceId: string }): Promise<{ deleted: boolean }>;
  "sources.preview_mapping"(ctx: SourcesCtx, input: { sourceId?: string; mapping?: Mapping; type?: string; payload: unknown }): Promise<{ normalized: Record<string, unknown>; action: "create" | "update" | "skip"; link: { sure?: string; unsure: Candidate[] }; problems: string[] }>;
  "sources.deliveries.list"(ctx: SourcesCtx, input: { sourceId: string; status?: DeliveryStatus; cursor?: string; limit?: number }): Promise<{ deliveries: DeliveryRow[]; next?: string; total?: number }>;
  "sources.replay"(ctx: SourcesCtx, input: { deliveryId: string }): Promise<{ status: "accepted" | "duplicate" | "rejected" | "failed"; recordIds: string[] }>;
  "sources.ingest"(ctx: SourcesCtx, input: { source: string; receivedAt: number; headers: Record<string, string>; body: string; runAutomations?: boolean }): Promise<IngestOut>;
  "sources.link.match"(ctx: SourcesCtx, input: { type: string; row: Record<string, unknown>; by?: string[] }): Promise<{ sure?: string; unsure: Candidate[] }>;
  "sources.link.list_pending"(ctx: SourcesCtx, input: { type?: string; cursor?: string; limit?: number }): Promise<{ pending: { matchId: string; deliveryId: string; sourceId: string; type: string; row: Record<string, unknown>; candidates: Candidate[] }[]; next?: string; total?: number }>;
  "sources.link.resolve"(ctx: SourcesCtx, input: { matchId: string; recordId?: string; createNew?: boolean; ignore?: boolean }): Promise<{ recordId?: string }>;
  "sources.health"(ctx: SourcesCtx, input: Record<string, never>): Promise<{ state: "healthy" | "degraded" | "down"; detail?: string; latencyMs?: number }>;
}

interface SourceDb {
  source_id: string; key: string; title: string; connector: string | null; connection_id: string | null; type: string; verify: Verify; secret_name: string | null;
  state: string; paused_reason: string | null; mapping: string | null; created_by: string | null; created_at: number; updated_at: number;
}
interface DeliveryDb { delivery_id: string; source_id: string; received_at: number; provider_id: string | null; status: DeliveryStatus; error: string | null; record_ids: string }
interface MatchDb { match_id: string; delivery_id: string; source_id: string; type: string; row: string; candidates: string; status: string; record_id: string | null; created_at: number }

const MAX_BODY = 1_048_576;
const DEFAULT_LINK_FIELDS = ["email", "phone", "website", "domain"];
const present = (v: unknown): boolean => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0);
const msgOf = (e: unknown): string => {
  const x = e as { error?: { message?: string }; message?: string };
  return x?.error?.message ?? x?.message ?? String(e);
};
const slug = (s: string): string => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "webhook";
const page = (input: { cursor?: string; limit?: number }): { start: number; limit: number } => ({
  start: input.cursor && /^\d+$/.test(input.cursor) ? Number(input.cursor) : 0, limit: Math.min(Math.max(input.limit ?? 100, 1), 500),
});

interface RecRow { id: string; fields: Record<string, unknown> }

export function createHooksHandlers(deps: SourcesDeps): HooksHandlers {
  const { tx } = deps;
  const ready = (): Tx => { ensureTables(tx); return tx; };

  // ---- reading sources ----

  const mappingOf = (r: SourceDb): Mapping | undefined => (r.mapping ? (JSON.parse(r.mapping) as Mapping) : undefined);

  const stateOf = (r: SourceDb, failed24h: number, lastStatus: string | undefined): SourceState =>
    r.state === "paused" ? "paused" : failed24h >= 3 && lastStatus === "failed" ? "failing" : "active";

  const rowOf = (r: SourceDb): SourceRow => {
    const since = nowOf(deps) - DAY;
    const stat = tx.get<{ n: number; failed: number; last: number | null }>(
      "SELECT count(*) AS n, coalesce(sum(status = 'failed'), 0) AS failed, max(received_at) AS last FROM src_deliveries WHERE source_id = ? AND received_at > ? AND status != 'rejected'", r.source_id, since,
    );
    const last = tx.get<{ status: string; received_at: number }>("SELECT status, received_at FROM src_deliveries WHERE source_id = ? AND status != 'rejected' ORDER BY received_at DESC, rowid DESC LIMIT 1", r.source_id);
    const m = mappingOf(r);
    return {
      sourceId: r.source_id, key: r.key, title: r.title, ...(r.connector ? { connector: r.connector } : {}), ...(r.connection_id ? { connectionId: r.connection_id } : {}),
      path: `/hooks/${r.key}`, verify: r.verify, type: r.type, state: stateOf(r, stat?.failed ?? 0, last?.status),
      ...(last ? { lastReceivedAt: last.received_at } : {}), received24h: stat?.n ?? 0, failed24h: stat?.failed ?? 0, ...(m ? { mapping: m } : {}),
    };
  };

  const need = (ctx: SourcesCtx, sourceId: string): SourceDb => {
    ready();
    return tx.get<SourceDb>("SELECT * FROM src_sources WHERE source_id = ?", sourceId) ?? refuse(ctx, "validation.not_found", "There is no such source.");
  };

  const deliveryRow = (r: DeliveryDb): DeliveryRow => ({
    deliveryId: r.delivery_id, sourceId: r.source_id, receivedAt: r.received_at, ...(r.provider_id !== null ? { providerId: r.provider_id } : {}),
    status: r.status, ...(r.error !== null ? { error: r.error } : {}), recordIds: JSON.parse(r.record_ids) as string[],
  });

  // ---- records through the capability API ----

  const find = async (ctx: SourcesCtx, type: string, by: readonly string[], row: Record<string, unknown>, limit = 2): Promise<RecRow[]> => {
    const out = (await ctx.call("records.query", { type, filter: { and: by.map((f) => ({ field: f, op: "eq", value: row[f] })) }, limit })) as { rows: RecRow[] };
    return out.rows;
  };

  const typeFields = async (ctx: SourcesCtx, type: string): Promise<{ key: string; required?: boolean }[]> => {
    const out = (await ctx.call("schema.types.get", { type })) as { type: { fields: { key: string; required?: boolean }[] } };
    return out.type.fields;
  };

  /** The shared linking step. A sure match is the only record that agrees on every given field; anything else that agrees on some is unsure. */
  const linkMatch = async (ctx: SourcesCtx, type: string, row: Record<string, unknown>, by: readonly string[]): Promise<{ sure?: string; unsure: Candidate[] }> => {
    const keys = by.filter((f) => present(row[f]));
    if (!keys.length) return { unsure: [] };
    const hits = new Map<string, Set<string>>();
    for (const f of keys) for (const r of await find(ctx, type, [f], row, 20)) hits.set(r.id, (hits.get(r.id) ?? new Set()).add(f));
    const all = [...hits].map(([recordId, fs]) => ({ recordId, type, score: fs.size / keys.length, reasons: [...fs].map((f) => `${f} matches`) })).sort((a, b) => b.score - a.score || a.recordId.localeCompare(b.recordId));
    const full = all.filter((c) => c.score === 1);
    if (full.length === 1 && all.length === 1) return { sure: full[0]!.recordId, unsure: [] };
    return { unsure: all };
  };

  // ---- the pipeline ----

  interface Finish { status: DeliveryStatus; recordIds?: string[]; error?: string; providerId?: string }

  async function run(ctx: SourcesCtx, src: SourceDb, body: string, receivedAt: number, o: { runAutomations: boolean; deliveryId?: string }): Promise<IngestOut> {
    ready();
    const now = nowOf(deps);
    const deliveryId = o.deliveryId ?? mintShort("dlv", now);
    const mapping = mappingOf(src);
    const finish = (f: Finish): IngestOut => {
      tx.run(
        "INSERT INTO src_deliveries (delivery_id, source_id, received_at, provider_id, status, error, record_ids) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(delivery_id) DO UPDATE SET provider_id = excluded.provider_id, status = excluded.status, error = excluded.error, record_ids = excluded.record_ids",
        deliveryId, src.source_id, receivedAt, f.providerId ?? null, f.status, f.error ?? null, JSON.stringify(f.recordIds ?? []),
      );
      if (f.status === "failed" || f.status === "linked_pending") tx.run("INSERT INTO src_payloads (delivery_id, body, run_automations) VALUES (?, ?, ?) ON CONFLICT(delivery_id) DO UPDATE SET body = excluded.body, run_automations = excluded.run_automations", deliveryId, body, o.runAutomations ? 1 : 0);
      else tx.run("DELETE FROM src_payloads WHERE delivery_id = ?", deliveryId);
      const status = f.status === "linked_pending" ? "accepted" : f.status === "failed" ? "failed" : f.status;
      return { status: status as IngestOut["status"], deliveryId, recordIds: f.recordIds ?? [] };
    };
    const failed = (error: string, providerId?: string): IngestOut => {
      ctx.emit("source.mapping_failed", `entity/${deliveryId}`, { sourceId: src.source_id, deliveryId, error });
      return finish({ status: "failed", error, ...(providerId ? { providerId } : {}) });
    };

    if (!mapping) return failed("The source has no mapping yet.");
    let payload: unknown;
    try { payload = parseBody(body); } catch (e) {
      ctx.emit("source.rejected", `entity/${src.key}`, { sourceId: src.source_id, source: src.key, reason: "bad_payload" });
      const out = finish({ status: "rejected", error: `bad payload: ${msgOf(e)}` });
      return { ...out, reason: "bad_payload" };
    }
    let n;
    try { n = normalise(mapping, payload); } catch (e) { return failed(`The mapping could not be applied: ${msgOf(e)}`); }
    if (n.providerId === undefined) return failed(`The payload has no provider id at ${mapping.dedupe}.`);
    const providerId = n.providerId;
    if (tx.get("SELECT 1 AS x FROM source_seen WHERE source = ? AND provider_id = ?", src.key, providerId)) {
      ctx.emit("source.deduped", `entity/${deliveryId}`, { sourceId: src.source_id, deliveryId, providerId });
      return finish({ status: "duplicate", providerId });
    }
    const row = n.row;
    const lacks = mapping.match.filter((k) => !present(row[k]));
    if (lacks.length) return failed(`The payload has no value for match field ${lacks.join(", ")}.`, providerId);

    try {
      let recordId: string | undefined;
      let linkedBy: "rule" | undefined;
      const exact = mapping.match.length ? await find(ctx, src.type, mapping.match, row) : [];
      if (exact.length === 1) recordId = exact[0]!.id;
      if (recordId === undefined && exact.length === 0 && mapping.link?.length) {
        const m = await linkMatch(ctx, src.type, row, mapping.link);
        if (m.sure) {
          await ctx.call("records.update", { type: src.type, recordId: m.sure, patch: row });
          recordId = m.sure;
          linkedBy = "rule";
        } else if (m.unsure.length) {
          const matchId = mintShort("mat", now);
          tx.run("INSERT INTO src_matches (match_id, delivery_id, source_id, type, row, candidates, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", matchId, deliveryId, src.source_id, src.type, JSON.stringify(row), JSON.stringify(m.unsure), now);
          ctx.emit("source.link_pending", `entity/${matchId}`, { sourceId: src.source_id, deliveryId, matchId, candidates: m.unsure.length });
          return finish({ status: "linked_pending", providerId });
        }
      }
      if (recordId === undefined) {
        if (mapping.match.length) {
          await ctx.call("records.bulk_upsert", { idempotencyKey: `sources.delivery:${deliveryId}:upsert`, type: src.type, rows: [row], match: mapping.match, runAutomations: o.runAutomations });
          recordId = (await find(ctx, src.type, mapping.match, row, 1))[0]?.id;
        } else {
          const made = (await ctx.call("records.create", { idempotencyKey: `sources.delivery:${deliveryId}:create`, type: src.type, fields: row })) as { record: { id: string } };
          recordId = made.record.id;
        }
      } else if (linkedBy === undefined) {
        await ctx.call("records.bulk_upsert", { idempotencyKey: `sources.delivery:${deliveryId}:update`, type: src.type, rows: [row], match: mapping.match, runAutomations: o.runAutomations });
      }
      const recordIds = recordId ? [recordId] : [];
      tx.run("INSERT OR IGNORE INTO source_seen (source, provider_id, seen_at) VALUES (?, ?, ?)", src.key, providerId, now);
      if (linkedBy && recordId) ctx.emit("source.linked", `record/${recordId}`, { sourceId: src.source_id, deliveryId, recordId, by: linkedBy });
      ctx.emit("source.received", `entity/${deliveryId}`, { sourceId: src.source_id, deliveryId, source: src.key, providerId, type: src.type, recordIds });
      return finish({ status: "accepted", recordIds, providerId });
    } catch (e) {
      return failed(msgOf(e), providerId);
    }
  }

  // ---- handlers ----

  const pick = (connector: string, title: string): { key: string; path: string; verify: Verify } | undefined => {
    const c = deps.registry.connectors.find((x) => x.key === connector);
    const list = c?.sources ?? [];
    return list.find((s) => title.toLowerCase().includes(s.key.toLowerCase())) ?? list[0];
  };

  const uniqueKey = (base: string): string => {
    let key = base;
    for (let n = 2; tx.get("SELECT 1 AS x FROM src_sources WHERE key = ?", key); n++) key = `${base}-${n}`;
    return key;
  };

  const checkMapping = async (ctx: SourcesCtx, type: string, mapping: Mapping): Promise<void> => {
    const bad = mappingProblem(mapping);
    if (bad) refuse(ctx, "validation.bad_input", bad);
    const fields = await typeFields(ctx, type);
    const keys = new Set(fields.map((f) => f.key));
    for (const f of mapping.fields) if (!keys.has(f.to)) refuse(ctx, "validation.bad_input", `${type} has no field ${f.to}.`);
  };

  return {
    "sources.list": async (_ctx, input) => {
      ready();
      let rows = tx.all<SourceDb>("SELECT * FROM src_sources ORDER BY created_at, source_id").map(rowOf);
      if (input.type !== undefined) rows = rows.filter((r) => r.type === input.type);
      if (input.state !== undefined) rows = rows.filter((r) => r.state === input.state);
      const { start, limit } = page(input);
      return { sources: rows.slice(start, start + limit), ...(start + limit < rows.length ? { next: String(start + limit) } : {}), total: rows.length };
    },

    "sources.get": async (ctx, input) => ({ source: rowOf(need(ctx, input.sourceId)) }),

    "sources.kinds": async () => {
      const kinds: { key: string; title: string; connector?: string; verify: Verify; needsTeamSpace: boolean }[] = [{ key: "webhook", title: "Generic webhook", verify: "hmac", needsTeamSpace: true }];
      for (const c of deps.registry.connectors) {
        const list = c.sources ?? [];
        for (const s of list) kinds.push({ key: list.length > 1 ? `${c.key}:${s.key}` : c.key, title: list.length > 1 ? `${c.title} (${s.key})` : c.title, connector: c.key, verify: s.verify, needsTeamSpace: true });
      }
      return { kinds };
    },

    "sources.create": async (ctx, input) => {
      ready();
      const generic = input.connector === "webhook";
      if (!generic && !deps.registry.connectors.some((c) => c.key === input.connector)) refuse(ctx, "validation.not_found", `There is no connector ${input.connector}.`);
      if (!input.title.trim()) refuse(ctx, "validation.bad_input", "A source needs a title.");
      await checkMapping(ctx, input.type, input.mapping);
      const declared = generic ? undefined : pick(input.connector, input.title);
      if (!generic && !declared) refuse(ctx, "validation.bad_input", `${input.connector} declares no inbound source: use a generic webhook.`);
      const verify = input.verify ?? declared?.verify ?? "hmac";
      const key = uniqueKey(declared ? declared.path.replace(/^\/hooks\//, "") : slug(input.title));
      const now = nowOf(deps);
      const sourceId = mintShort("src", now);
      tx.run(
        "INSERT INTO src_sources (source_id, key, title, connector, connection_id, type, verify, secret_name, state, mapping, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)",
        sourceId, key, input.title, generic ? null : input.connector, input.connectionId ?? null, input.type, verify, input.secretName ?? null, JSON.stringify(input.mapping), ctx.actor ?? null, now, now,
      );
      ctx.emit("source.created", `entity/${sourceId}`, { sourceId, key, type: input.type });
      return { source: rowOf(need(ctx, sourceId)) };
    },

    "sources.update": async (ctx, input) => {
      const src = need(ctx, input.sourceId);
      const type = input.type ?? src.type;
      const mapping = input.mapping ?? mappingOf(src);
      if (input.type !== undefined || input.mapping !== undefined) {
        if (!mapping) refuse(ctx, "validation.bad_input", "A source needs a mapping.");
        await checkMapping(ctx, type, mapping!);
      }
      if (input.title !== undefined && !input.title.trim()) refuse(ctx, "validation.bad_input", "A source needs a title.");
      const changed = (["title", "type", "mapping", "verify"] as const).filter((k) => input[k] !== undefined);
      tx.run("UPDATE src_sources SET title = ?, type = ?, mapping = ?, verify = ?, updated_at = ? WHERE source_id = ?",
        input.title ?? src.title, type, mapping ? JSON.stringify(mapping) : null, input.verify ?? src.verify, nowOf(deps), src.source_id);
      ctx.emit("source.updated", `entity/${src.source_id}`, { sourceId: src.source_id, fields: changed });
      return { source: rowOf(need(ctx, src.source_id)) };
    },

    "sources.set_secret": async (ctx, input) => {
      const src = need(ctx, input.sourceId);
      if (!input.secretName.trim()) refuse(ctx, "validation.bad_input", "Name the Vault item that holds the signing secret.");
      tx.run("UPDATE src_sources SET secret_name = ?, updated_at = ? WHERE source_id = ?", input.secretName, nowOf(deps), src.source_id);
      ctx.emit("source.updated", `entity/${src.source_id}`, { sourceId: src.source_id, fields: ["secret"] });
      return { ok: true };
    },

    "sources.pause": async (ctx, input) => {
      const src = need(ctx, input.sourceId);
      tx.run("UPDATE src_sources SET state = 'paused', paused_reason = ?, updated_at = ? WHERE source_id = ?", input.reason ?? null, nowOf(deps), src.source_id);
      ctx.emit("source.paused", `entity/${src.source_id}`, { sourceId: src.source_id });
      return { ok: true };
    },

    "sources.resume": async (ctx, input) => {
      const src = need(ctx, input.sourceId);
      tx.run("UPDATE src_sources SET state = 'active', paused_reason = NULL, updated_at = ? WHERE source_id = ?", nowOf(deps), src.source_id);
      ctx.emit("source.resumed", `entity/${src.source_id}`, { sourceId: src.source_id });
      return { ok: true };
    },

    "sources.delete": async (ctx, input) => {
      const src = need(ctx, input.sourceId);
      tx.run("DELETE FROM src_payloads WHERE delivery_id IN (SELECT delivery_id FROM src_deliveries WHERE source_id = ?)", src.source_id);
      tx.run("DELETE FROM src_deliveries WHERE source_id = ?", src.source_id);
      tx.run("DELETE FROM src_matches WHERE source_id = ?", src.source_id);
      tx.run("DELETE FROM source_seen WHERE source = ?", src.key);
      tx.run("DELETE FROM src_sources WHERE source_id = ?", src.source_id);
      ctx.emit("source.deleted", `entity/${src.source_id}`, { sourceId: src.source_id });
      return { deleted: true };
    },

    "sources.preview_mapping": async (ctx, input) => {
      ready();
      const src = input.sourceId !== undefined ? need(ctx, input.sourceId) : undefined;
      const mapping = input.mapping ?? (src ? mappingOf(src) : undefined);
      const type = input.type ?? src?.type;
      const problems: string[] = [];
      if (!mapping) refuse(ctx, "validation.bad_input", "Give a mapping or a source that has one.");
      if (!type) refuse(ctx, "validation.bad_input", "Give the record type or a source.");
      const shape = mappingProblem(mapping!);
      if (shape) return { normalized: {}, action: "skip" as const, link: { unsure: [] }, problems: [shape] };
      let n;
      try { n = normalise(mapping!, input.payload); } catch (e) { return { normalized: {}, action: "skip" as const, link: { unsure: [] }, problems: [`The mapping could not be applied: ${msgOf(e)}`] }; }
      if (n.providerId === undefined) problems.push(`The payload has no provider id at ${mapping!.dedupe}.`);
      const pointers = new Map(mapping!.fields.map((f) => [f.to, f.from]));
      for (const m of n.missing) problems.push(`No value at ${pointers.get(m)} for ${m}.`);
      try {
        const fields = await typeFields(ctx, type!);
        const keys = new Set(fields.map((f) => f.key));
        for (const f of mapping!.fields) if (!keys.has(f.to)) problems.push(`${type} has no field ${f.to}.`);
        for (const f of fields) if (f.required && !present(n.row[f.key])) problems.push(`${f.key} is required but the mapping does not fill it from this payload.`);
      } catch (e) { problems.push(`The record type cannot be read: ${msgOf(e)}`); }
      let action: "create" | "update" | "skip" = "create";
      let link: { sure?: string; unsure: Candidate[] } = { unsure: [] };
      const ready2 = mapping!.match.length > 0 && mapping!.match.every((k) => present(n.row[k]));
      const exact = ready2 ? await find(ctx, type!, mapping!.match, n.row) : [];
      if (exact.length === 1) action = Object.entries(n.row).every(([k, v]) => same(exact[0]!.fields[k], v)) ? "skip" : "update";
      else if (exact.length === 0 && mapping!.link?.length) {
        link = await linkMatch(ctx, type!, n.row, mapping!.link);
        if (link.sure) action = "update";
      }
      return { normalized: n.row, action, link, problems };
    },

    "sources.deliveries.list": async (ctx, input) => {
      need(ctx, input.sourceId);
      const rows = tx.all<DeliveryDb>(
        `SELECT * FROM src_deliveries WHERE source_id = ? ${input.status !== undefined ? "AND status = ?" : ""} ORDER BY received_at DESC, rowid DESC`, input.sourceId, ...(input.status !== undefined ? [input.status] : []),
      );
      const { start, limit } = page(input);
      return { deliveries: rows.slice(start, start + limit).map(deliveryRow), ...(start + limit < rows.length ? { next: String(start + limit) } : {}), total: rows.length };
    },

    "sources.replay": async (ctx, input) => {
      ready();
      const d = tx.get<DeliveryDb>("SELECT * FROM src_deliveries WHERE delivery_id = ?", input.deliveryId) ?? refuse(ctx, "validation.not_found", "There is no such delivery.");
      const src = need(ctx, d.source_id);
      if (d.status !== "failed") refuse(ctx, "validation.precondition_failed", "Only a failed delivery can be processed again.");
      const p = tx.get<{ body: string; run_automations: number }>("SELECT body, run_automations FROM src_payloads WHERE delivery_id = ?", d.delivery_id);
      if (!p) refuse(ctx, "validation.precondition_failed", "The body of this delivery is no longer kept.");
      const out = await run(ctx, src, p!.body, d.received_at, { runAutomations: p!.run_automations === 1, deliveryId: d.delivery_id });
      return { status: out.status, recordIds: out.recordIds };
    },

    "sources.ingest": async (ctx, input) => {
      ready();
      const src = tx.get<SourceDb>("SELECT * FROM src_sources WHERE key = ?", input.source);
      const reject = (reason: "bad_signature" | "unknown_source" | "paused" | "too_large", s?: SourceDb): IngestOut => {
        ctx.emit("source.rejected", `entity/${input.source}`, { ...(s ? { sourceId: s.source_id } : {}), source: input.source, reason });
        let deliveryId: string | undefined;
        if (s) {
          deliveryId = mintShort("dlv", nowOf(deps));
          tx.run("INSERT INTO src_deliveries (delivery_id, source_id, received_at, provider_id, status, error, record_ids) VALUES (?, ?, ?, NULL, 'rejected', ?, '[]')", deliveryId, s.source_id, input.receivedAt, reason);
        }
        return { status: "rejected", ...(deliveryId ? { deliveryId } : {}), recordIds: [], reason };
      };
      if (!src) return reject("unknown_source");
      if (src.state === "paused") return reject("paused", src);
      if (new TextEncoder().encode(input.body).length > (deps.maxBodyBytes ?? MAX_BODY)) {
        reject("too_large", src);
        refuse(ctx, "validation.too_large", "The delivery is larger than this source accepts.");
      }
      if (src.verify !== "none") {
        const secret = src.secret_name && deps.secret ? await deps.secret(src.secret_name) : undefined;
        if (!secret) return reject("bad_signature", src);
        if (!verifyDelivery(src.verify, secret, input.headers, input.body, input.receivedAt).ok) return reject("bad_signature", src);
      }
      return run(ctx, src, input.body, input.receivedAt, { runAutomations: input.runAutomations ?? true });
    },

    "sources.link.match": async (ctx, input) => {
      const by = input.by ?? DEFAULT_LINK_FIELDS.filter((f) => present(input.row[f]));
      return linkMatch(ctx, input.type, input.row, by);
    },

    "sources.link.list_pending": async (_ctx, input) => {
      ready();
      const rows = tx.all<MatchDb>(`SELECT * FROM src_matches WHERE status = 'pending' ${input.type !== undefined ? "AND type = ?" : ""} ORDER BY created_at, match_id`, ...(input.type !== undefined ? [input.type] : []));
      const { start, limit } = page(input);
      return {
        pending: rows.slice(start, start + limit).map((m) => ({ matchId: m.match_id, deliveryId: m.delivery_id, sourceId: m.source_id, type: m.type, row: JSON.parse(m.row) as Record<string, unknown>, candidates: JSON.parse(m.candidates) as Candidate[] })),
        ...(start + limit < rows.length ? { next: String(start + limit) } : {}), total: rows.length,
      };
    },

    "sources.link.resolve": async (ctx, input) => {
      ready();
      const m = tx.get<MatchDb>("SELECT * FROM src_matches WHERE match_id = ?", input.matchId) ?? refuse(ctx, "validation.not_found", "There is no such match.");
      if (m.status !== "pending") refuse(ctx, "validation.precondition_failed", "This match was already settled.");
      const choices = [input.recordId !== undefined, input.createNew === true, input.ignore === true].filter(Boolean).length;
      if (choices !== 1) refuse(ctx, "validation.precondition_failed", "Choose one: link to a candidate, create a new record, or ignore.");
      const row = JSON.parse(m.row) as Record<string, unknown>;
      const candidates = JSON.parse(m.candidates) as Candidate[];
      const now = nowOf(deps);
      const delivery = tx.get<DeliveryDb>("SELECT * FROM src_deliveries WHERE delivery_id = ?", m.delivery_id);
      const settle = (status: string, recordId: string | null): void => {
        tx.run("UPDATE src_matches SET status = ?, record_id = ?, resolved_at = ? WHERE match_id = ?", status, recordId, now, m.match_id);
        tx.run("UPDATE src_deliveries SET status = 'accepted', error = ?, record_ids = ? WHERE delivery_id = ?", status === "ignored" ? "ignored by a person" : null, JSON.stringify(recordId ? [recordId] : []), m.delivery_id);
        tx.run("DELETE FROM src_payloads WHERE delivery_id = ?", m.delivery_id);
        const src = tx.get<{ key: string }>("SELECT key FROM src_sources WHERE source_id = ?", m.source_id);
        if (src && delivery?.provider_id) tx.run("INSERT OR IGNORE INTO source_seen (source, provider_id, seen_at) VALUES (?, ?, ?)", src.key, delivery.provider_id, now);
      };
      if (input.ignore) { settle("ignored", null); return {}; }
      if (input.createNew) {
        const made = (await ctx.call("records.create", { idempotencyKey: `sources.link.resolve:${m.match_id}:create`, type: m.type, fields: row })) as { record: { id: string } };
        settle("created", made.record.id);
        return { recordId: made.record.id };
      }
      const target = candidates.find((c) => c.recordId === input.recordId);
      if (!target) refuse(ctx, "validation.precondition_failed", "That record is not one of the candidates.");
      await ctx.call("records.update", { type: m.type, recordId: target!.recordId, patch: row });
      settle("linked", target!.recordId);
      ctx.emit("source.linked", `record/${target!.recordId}`, { sourceId: m.source_id, deliveryId: m.delivery_id, recordId: target!.recordId, by: "person" });
      return { recordId: target!.recordId };
    },

    "sources.health": async () => {
      ready();
      if (deps.reachable && !(await deps.reachable())) return { state: "down" as const, detail: "The public address does not answer." };
      const now = nowOf(deps);
      const stuck = tx.get<{ n: number; oldest: number | null }>("SELECT count(*) AS n, min(received_at) AS oldest FROM src_deliveries WHERE status IN ('failed', 'linked_pending') AND received_at < ?", now - 3_600_000);
      const failing = tx.all<SourceDb>("SELECT * FROM src_sources WHERE state != 'paused'").map(rowOf).filter((s) => s.state === "failing");
      const noSecret = tx.all<{ key: string }>("SELECT key FROM src_sources WHERE verify != 'none' AND (secret_name IS NULL OR secret_name = '') AND state != 'paused'");
      const bits: string[] = [];
      if (failing.length) bits.push(`${failing.length} source${failing.length === 1 ? " is" : "s are"} failing`);
      if (stuck?.n) bits.push(`${stuck.n} deliver${stuck.n === 1 ? "y has" : "ies have"} waited over an hour`);
      if (noSecret.length) bits.push(`${noSecret.map((s) => s.key).join(", ")} ${noSecret.length === 1 ? "has" : "have"} no signing secret and refuse${noSecret.length === 1 ? "s" : ""} every delivery`);
      return bits.length ? { state: "degraded" as const, detail: bits.join("; ") } : { state: "healthy" as const };
    },
  };
}

