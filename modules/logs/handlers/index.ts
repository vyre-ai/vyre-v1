// Capability handlers for logs (spec 4.18, ARCH 4.9 to 4.11). Reads go through search.ts, writes through sink.ts.
// Reading logs is audited by the invoke pipeline (`audit: always` on every read capability), so a read handler emits nothing.
// Rows are scoped to ctx.space and every statement names a logs_* table, which is all ctx.db accepts.

import type { AdminLogEntry } from "../../../lib/admin-export.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { LogWriter, readSettings, runRetention, writeSettings, MAX_UPLOAD } from "./sink.ts";
import type { LevelName, Settings } from "./sink.ts";
import { exportLines, failWith, queryLogs, spansOf, traceView } from "./search.ts";
import type { LogFilter, Page } from "./search.ts";

/** The part of the host Ctx these handlers use. The full Ctx satisfies it. */
export type LogCtx = Pick<Ctx, "space" | "principal" | "actingFor" | "trace" | "device" | "run" | "now" | "db" | "emit"> & { exports?: { logs(rows: readonly AdminLogEntry[]): Promise<string> } };

type FilterIn = LogFilter;
type PageIn = Page;
interface UploadEntry { at: number; traceId?: string; level: LevelName; msg: string; attrs?: Record<string, unknown> }

/** Rows an export holds at most. */
export const EXPORT_MAX = 10_000;
/** Replay reads at most this many log rows of the run. */
const REPLAY_ROWS = 2_000;

function mint(prefix: string): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(9));
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `${prefix}_${hex}`;
}

/** Keep only the filter keys, so a page cursor or a stray key never reaches SQL or a stored stream. */
export function filterOf(input: FilterIn): LogFilter {
  const out: LogFilter = {};
  if (input.person) out.person = input.person;
  if (input.agent) out.agent = input.agent;
  if (input.place) out.place = input.place;
  if (input.recordId) out.recordId = input.recordId;
  if (input.runId) out.runId = input.runId;
  if (input.traceId) out.traceId = input.traceId;
  if (input.cap) out.cap = input.cap;
  if (input.level) out.level = input.level;
  if (input.result) out.result = input.result;
  if (input.sinceMs !== undefined) out.sinceMs = input.sinceMs;
  if (input.untilMs !== undefined) out.untilMs = input.untilMs;
  return out;
}

function pageOf(input: PageIn): Page {
  const out: Page = {};
  if (input.cursor) out.cursor = input.cursor;
  if (input.limit !== undefined) out.limit = input.limit;
  return out;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export async function query(ctx: LogCtx, input: FilterIn & PageIn) {
  return queryLogs(ctx.db, ctx.space, filterOf(input), pageOf(input));
}

export async function tail(ctx: LogCtx, input: FilterIn) {
  const streamId = mint("stm");
  ctx.db.run(
    "INSERT INTO logs_stream (id, space, filter, principal, at) VALUES (?, ?, ?, ?, ?)",
    streamId, ctx.space, JSON.stringify(filterOf(input)), ctx.principal.id, ctx.now(),
  );
  return { streamId };
}

export async function trace(ctx: LogCtx, input: { traceId: string }) {
  return traceView(ctx.db, ctx.space, input.traceId);
}

export async function spans(ctx: LogCtx, input: { traceId?: string; name?: string } & PageIn) {
  const filter: { traceId?: string; name?: string } = {};
  if (input.traceId) filter.traceId = input.traceId;
  if (input.name) filter.name = input.name;
  return spansOf(ctx.db, ctx.space, filter, pageOf(input));
}

export async function exportLogs(ctx: LogCtx, input: FilterIn) {
  const lines = exportLines(ctx.db, ctx.space, filterOf(input), EXPORT_MAX);
  if(!ctx.exports)return failWith(ctx.trace.traceId,'internal.unavailable','Private export storage is unavailable.');
  const fileId = await ctx.exports.logs(lines.map((line)=>JSON.parse(line) as AdminLogEntry));
  ctx.db.run(
    "INSERT INTO logs_export (id, space, principal, at, row_count, lines) VALUES (?, ?, ?, ?, ?, ?)",
    fileId, ctx.space, ctx.principal.id, ctx.now(), lines.length, lines.join("\n"),
  );
  return { fileId };
}

export async function clientUpload(ctx: LogCtx, input: { device: string; entries: UploadEntry[] }) {
  const settings = readSettings(ctx.db, ctx.space);
  const writer = new LogWriter({ db: ctx.db, space: ctx.space, now: () => ctx.now(), batchMs: 1, minLevel: settings.level });
  let accepted = 0;
  const entries = input.entries.slice(0, MAX_UPLOAD);
  for (const e of entries) {
    const line: Record<string, unknown> = {
      at: e.at, level: e.level, msg: e.msg, device: input.device, place: "client", actor: ctx.principal.id,
    };
    if (ctx.actingFor) line["onBehalf"] = ctx.actingFor;
    if (e.traceId) line["traceId"] = e.traceId;
    if (e.attrs) line["attrs"] = e.attrs;
    if (writer.write(line)) accepted += 1;
  }
  writer.flush();
  const sizeBytes = new TextEncoder().encode(JSON.stringify(entries)).length;
  ctx.emit("client_log.uploaded", `entity/${input.device}`, { device: input.device, sizeBytes }, { vis: "owner" });
  return { accepted };
}

interface Step { name: string; ok: boolean; detail?: string }

function count(ctx: LogCtx, sql: string, ...args: unknown[]): number {
  const r = obj(ctx.db.all(sql, ...args)[0]);
  const n = r?.["n"];
  return typeof n === "number" ? n : 0;
}

/**
 * A replay works on what the logs and events kept: the events up to the sequence number, then the run's own log rows in order.
 * Rows marked outward (attrs.outward) are recorded and never sent. Sealed and Restricted values were never stored, so none can leak.
 */
export async function replayStart(ctx: LogCtx, input: { atSeq: number; runId?: string; conflictId?: string }) {
  const replayId = mint("rpl");
  const events = count(ctx, "SELECT COUNT(*) AS n FROM logs_event WHERE seq <= ?", input.atSeq);
  const steps: Step[] = [{ name: "copy", ok: true, detail: `${events} events up to ${input.atSeq}` }];
  let recorded = 0;
  let state: "done" | "failed" = "done";
  if (input.runId || input.conflictId) {
    const rows = input.runId
      ? ctx.db.all("SELECT cap, result, attrs FROM logs_row WHERE space = ? AND run_id = ? AND cap IS NOT NULL ORDER BY id LIMIT ?", ctx.space, input.runId, REPLAY_ROWS)
      : ctx.db.all("SELECT cap, result, attrs FROM logs_row WHERE space = ? AND entity_id = ? AND cap IS NOT NULL ORDER BY id LIMIT ?", ctx.space, input.conflictId, REPLAY_ROWS);
    steps.push({ name: "seal", ok: true, detail: "sealed and Restricted values replaced" });
    if (rows.length === 0) {
      state = "failed";
      steps.push({ name: "source", ok: false, detail: "no log rows for this run or conflict" });
    }
    for (const raw of rows) {
      const r = obj(raw);
      const cap = r && typeof r["cap"] === "string" ? r["cap"] : null;
      if (!r || !cap) continue;
      let outward = false;
      if (typeof r["attrs"] === "string") {
        try { outward = obj(JSON.parse(r["attrs"]))?.["outward"] === true; } catch { outward = false; }
      }
      const result = typeof r["result"] === "string" ? r["result"] : "ok";
      if (outward) recorded += 1;
      steps.push({ name: cap, ok: result === "ok", detail: outward ? "recorded, not sent" : result === "ok" ? "replayed" : `original result ${result}` });
    }
  } else {
    steps.push({ name: "seal", ok: true, detail: "sealed and Restricted values replaced" });
  }
  ctx.db.run(
    "INSERT INTO logs_replay (id, space, at_seq, run_id, conflict_id, state, recorded_outward, steps, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    replayId, ctx.space, input.atSeq, input.runId ?? null, input.conflictId ?? null, state, recorded, JSON.stringify(steps), ctx.now(),
  );
  const started: { replayId: string; atSeq: number; runId?: string } = { replayId, atSeq: input.atSeq };
  if (input.runId) started.runId = input.runId;
  ctx.emit("replay.started", `entity/${replayId}`, started, { vis: "owner" });
  ctx.emit("replay.finished", `entity/${replayId}`, { replayId, recordedOutward: recorded }, { vis: "owner" });
  return { replayId };
}

export async function replayGet(ctx: LogCtx, input: { replayId: string }) {
  const row = obj(ctx.db.all("SELECT state, recorded_outward, steps FROM logs_replay WHERE id = ? AND space = ?", input.replayId, ctx.space)[0]);
  if (!row) return failWith(ctx.trace.traceId, "validation.not_found", "That replay does not exist.", { replayId: input.replayId });
  let steps: Step[] = [];
  try {
    const parsed = JSON.parse(String(row["steps"])) as unknown;
    if (Array.isArray(parsed)) steps = parsed.filter((s): s is Step => !!obj(s) && typeof (s as Step).name === "string" && typeof (s as Step).ok === "boolean");
  } catch { steps = []; }
  const raw = row["state"];
  const state: "running" | "done" | "failed" = raw === "running" || raw === "failed" ? raw : "done";
  const recordedOutward = typeof row["recorded_outward"] === "number" ? row["recorded_outward"] : 0;
  return { state, recordedOutward, steps };
}

export async function settingsGet(ctx: LogCtx, _input: Record<string, unknown>) {
  return readSettings(ctx.db, ctx.space);
}

/** Change levels and retention. Shorter windows apply at once: the retention pass runs right after the write. */
export async function settingsSet(ctx: LogCtx, input: { level?: LevelName; fullDays?: number; aggregateDays?: number }) {
  const cur = readSettings(ctx.db, ctx.space);
  const next: Settings = {
    level: input.level ?? cur.level,
    fullDays: input.fullDays !== undefined ? Math.trunc(input.fullDays) : cur.fullDays,
    aggregateDays: input.aggregateDays !== undefined ? Math.trunc(input.aggregateDays) : cur.aggregateDays,
  };
  if (next.fullDays < 1 || next.aggregateDays < 1) {
    return failWith(ctx.trace.traceId, "validation.bad_input", "Retention windows are at least one day.", { field: next.fullDays < 1 ? "fullDays" : "aggregateDays" });
  }
  if (next.aggregateDays < next.fullDays) {
    return failWith(ctx.trace.traceId, "validation.bad_input", "Summaries are kept at least as long as full logs.", { field: "aggregateDays" });
  }
  writeSettings(ctx.db, ctx.space, next);
  runRetention(ctx.db, ctx.space, ctx.now());
  return { ok: true };
}

import { purge } from "./purge.ts";

export const handlers = {
  "logs.client_upload": clientUpload,
  "logs.export": exportLogs,
  "logs.purge": purge,
  "logs.query": query,
  "logs.replay_get": replayGet,
  "logs.replay_start": replayStart,
  "logs.settings_get": settingsGet,
  "logs.settings_set": settingsSet,
  "logs.spans": spans,
  "logs.tail": tail,
  "logs.trace": trace,
};
