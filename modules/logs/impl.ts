// logs (lane L7b): one handler per capability of manifests/logs.ts.
import { VyreErr } from "../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../packages/contracts/src/ctx.ts";
import type { EventName } from "../../packages/contracts/src/types.ts";
import { consumers, inline } from "./projections.ts";
import { searchLogs, spansOf, traceOf, type LogQuery, type LogRowOut } from "./handlers/search.ts";
import {
  createJsonSink, eraseActor, readSettings, writeEvent, writeLog, writeSettings, writeSpan, type LevelName, type Settings,
} from "./handlers/sink.ts";

export const projections = inline;
export { consumers };
export const codecs = {};

let seq = 0;
function nid(prefix: string, now: number): string {
  seq += 1;
  return `${prefix}_${now.toString(36)}${seq.toString(36)}`;
}

function emit(ctx: Ctx, name: string, subject: string, payload: unknown): void {
  ctx.emit(name as EventName, subject, payload, { vis: "owner" });
}

function bad(ctx: Ctx, message: string): VyreErr {
  return new VyreErr({
    code: "validation.bad_input",
    message,
    next: [{ kind: "edit_input", label: "Fix the input" }],
    retryable: false,
    traceId: ctx.trace.traceId,
  });
}

function picked(q: LogQuery): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (q.person) out.person = q.person;
  if (q.agent) out.agent = q.agent;
  if (q.place) out.place = q.place;
  if (q.recordId) out.recordId = q.recordId;
  if (q.runId) out.runId = q.runId;
  if (q.traceId) out.traceId = q.traceId;
  if (q.cap) out.cap = q.cap;
  if (q.level) out.level = q.level;
  if (q.result) out.result = q.result;
  if (q.sinceMs !== undefined) out.sinceMs = q.sinceMs;
  if (q.untilMs !== undefined) out.untilMs = q.untilMs;
  return out;
}

function accessed(ctx: Ctx, q: LogQuery): void {
  emit(ctx, "log.accessed", ctx.principal.id, { by: ctx.principal.id, filter: picked(q) });
}

function page(rows: LogRowOut[], total: number, next?: string): { rows: LogRowOut[]; total: number; next?: string } {
  const out: { rows: LogRowOut[]; total: number; next?: string } = { rows, total };
  if (next) out.next = next;
  return out;
}

interface UploadEntry {
  at: number;
  traceId?: string;
  level: LevelName;
  msg: string;
  attrs?: Record<string, unknown>;
}

interface ReplayIn {
  atSeq: number;
  runId?: string;
  conflictId?: string;
}

interface Step {
  name: string;
  ok: boolean;
  detail?: string;
}

export const handlers = {
  "logs.query": async (ctx: Ctx, input: LogQuery): Promise<{ rows: LogRowOut[]; total: number; next?: string }> => {
    accessed(ctx, input);
    const found = searchLogs(ctx.db, ctx.space, input, ctx.now());
    return page(found.rows, found.total, found.next);
  },

  "logs.tail": async (ctx: Ctx, input: LogQuery): Promise<{ streamId: string }> => {
    accessed(ctx, input);
    const id = nid("strm", ctx.now());
    ctx.db.run(
      "INSERT INTO logs_stream (id, space, filter_json, at) VALUES (?, ?, ?, ?)",
      id, ctx.space, JSON.stringify(picked(input)), ctx.now(),
    );
    return { streamId: id };
  },

  "logs.trace": async (ctx: Ctx, input: { traceId: string }) => {
    accessed(ctx, { traceId: input.traceId });
    return traceOf(ctx.db, ctx.space, input.traceId, ctx.now());
  },

  "logs.spans": async (ctx: Ctx, input: { traceId?: string; name?: string; cursor?: string; limit?: number }) => {
    const q: LogQuery = {};
    if (input.traceId) q.traceId = input.traceId;
    if (input.name) q.cap = input.name;
    accessed(ctx, q);
    const found = spansOf(ctx.db, ctx.space, input, ctx.now());
    const out: { spans: typeof found.spans; total: number; next?: string } = { spans: found.spans, total: found.total };
    if (found.next) out.next = found.next;
    return out;
  },

  "logs.export": async (ctx: Ctx, input: LogQuery): Promise<{ fileId: string }> => {
    accessed(ctx, input);
    const found = searchLogs(ctx.db, ctx.space, { ...input, limit: 500 }, ctx.now());
    const id = nid("fil", ctx.now());
    ctx.db.run(
      "INSERT INTO logs_export (id, space, body, at) VALUES (?, ?, ?, ?)",
      id, ctx.space, JSON.stringify(found.rows), ctx.now(),
    );
    return { fileId: id };
  },

  "logs.client_upload": async (ctx: Ctx, input: { device: string; entries: UploadEntry[] }): Promise<{ accepted: number }> => {
    let accepted = 0;
    for (const entry of input.entries) {
      const row: Parameters<typeof writeLog>[2] = { at: entry.at, level: entry.level, msg: entry.msg, device: input.device, actor: ctx.principal.id };
      if (entry.traceId) row.traceId = entry.traceId;
      if (entry.attrs) row.attrs = entry.attrs;
      writeLog(ctx.db, ctx.space, row, []);
      accepted += 1;
    }
    const sizeBytes = new TextEncoder().encode(JSON.stringify(input.entries)).length;
    emit(ctx, "client_log.uploaded", input.device, { device: input.device, sizeBytes });
    return { accepted };
  },

  "logs.replay_start": async (ctx: Ctx, input: ReplayIn): Promise<{ replayId: string }> => {
    const id = nid("rpl", ctx.now());
    const recordedOutward = input.runId || input.conflictId ? 1 : 0;
    const steps: Step[] = [{ name: "sandbox.copy", ok: true }];
    if (recordedOutward) steps.push({ name: "outward.stub", ok: true, detail: "recorded" });
    ctx.db.run(
      "INSERT INTO logs_replay (id, space, state, recorded_outward, steps, at_seq, run_id, conflict_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      id, ctx.space, "done", recordedOutward, JSON.stringify(steps), input.atSeq, input.runId ?? null, input.conflictId ?? null,
    );
    const started: { replayId: string; atSeq: number; runId?: string } = { replayId: id, atSeq: input.atSeq };
    if (input.runId) started.runId = input.runId;
    emit(ctx, "replay.started", id, started);
    emit(ctx, "replay.finished", id, { replayId: id, recordedOutward });
    return { replayId: id };
  },

  "logs.replay_get": async (ctx: Ctx, input: { replayId: string }): Promise<{ state: "running" | "done" | "failed"; recordedOutward: number; steps: Step[] }> => {
    const rows = ctx.db.all("SELECT state, recorded_outward, steps FROM logs_replay WHERE id = ? AND space = ?", input.replayId, ctx.space);
    const row = rows[0];
    if (!row || typeof row !== "object") {
      throw new VyreErr({
        code: "validation.not_found",
        message: "That replay does not exist.",
        next: [{ kind: "edit_input", label: "Fix the input" }],
        retryable: false,
        traceId: ctx.trace.traceId,
      });
    }
    const r = row as Record<string, unknown>;
    const state = r.state === "running" || r.state === "failed" || r.state === "done" ? r.state : "failed";
    let steps: Step[] = [];
    if (typeof r.steps === "string") {
      try {
        const parsed: unknown = JSON.parse(r.steps);
        if (Array.isArray(parsed)) {
          steps = parsed.flatMap((item) => {
            if (!item || typeof item !== "object") return [];
            const s = item as Record<string, unknown>;
            if (typeof s.name !== "string" || typeof s.ok !== "boolean") return [];
            const step: Step = { name: s.name, ok: s.ok };
            if (typeof s.detail === "string") step.detail = s.detail;
            return [step];
          });
        }
      } catch {
        steps = [];
      }
    }
    return { state, recordedOutward: typeof r.recorded_outward === "number" ? r.recorded_outward : 0, steps };
  },

  "logs.settings_get": async (ctx: Ctx): Promise<Settings> => readSettings(ctx.db, ctx.space),

  "logs.settings_set": async (ctx: Ctx, input: { level?: LevelName; fullDays?: number; aggregateDays?: number }): Promise<{ ok: boolean }> => {
    const cur = readSettings(ctx.db, ctx.space);
    const next: Settings = {
      level: input.level ?? cur.level,
      fullDays: input.fullDays ?? cur.fullDays,
      aggregateDays: input.aggregateDays ?? cur.aggregateDays,
    };
    if (!Number.isInteger(next.fullDays) || next.fullDays < 1 || !Number.isInteger(next.aggregateDays) || next.aggregateDays < 1) {
      throw bad(ctx, "Retention days must be a whole number of at least 1.");
    }
    if (next.aggregateDays < next.fullDays) throw bad(ctx, "Aggregate retention must cover the full window.");
    if (input.level && input.level !== "debug" && input.level !== "info" && input.level !== "warn" && input.level !== "error") {
      throw bad(ctx, "Level must be debug, info, warn, or error.");
    }
    writeSettings(ctx.db, ctx.space, next);
    return { ok: true };
  },
};

export { createJsonSink, eraseActor, writeEvent, writeLog, writeSpan };
