// Capability handlers for logs. The host serves these once the manifest is live.
import { createBook } from "./sink.ts";
import type { LevelName, LogBook, SqlDb } from "./sink.ts";
import { query, spansOf, traceView } from "./search.ts";
import type { LogFilter } from "./search.ts";

export interface LogCtx {
  space: string;
  principal: { kind: string; id: string };
  actingFor?: string;
  trace: { traceId: string; spanId?: string };
  run?: string;
  device?: string;
  now(): number;
  db: SqlDb;
  emit(name: string, subject: string, payload: unknown, opts?: { vis?: "owner" | "space" }): void;
}

const books = new Map<string, LogBook>();

export function bookFor(space: string, now: () => number, db?: SqlDb): LogBook {
  let book = books.get(space);
  if (!book) {
    book = createBook({ space, now, batchMs: 250 });
    books.set(space, book);
  }
  book.setNow(now);
  if (db) book.bind(db);
  return book;
}

export function resetBooks(): void {
  for (const book of books.values()) book.close();
  books.clear();
}

function mint(prefix: string): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(9));
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `${prefix}_${hex}`;
}

function filterOf(input: LogFilter): LogFilter {
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

function pageOf(input: { cursor?: string; limit?: number }): { cursor?: string; limit?: number } {
  const out: { cursor?: string; limit?: number } = {};
  if (input.cursor) out.cursor = input.cursor;
  if (input.limit !== undefined) out.limit = input.limit;
  return out;
}

export const handlers = {
  "logs.query": async (ctx: LogCtx, input: LogFilter & { cursor?: string; limit?: number }) => {
    const book = bookFor(ctx.space, () => ctx.now(), ctx.db);
    return query(book, filterOf(input), pageOf(input));
  },

  "logs.tail": async (ctx: LogCtx, input: LogFilter) => {
    const book = bookFor(ctx.space, () => ctx.now(), ctx.db);
    const streamId = mint("stm");
    book.addStream(streamId, JSON.stringify(filterOf(input)));
    return { streamId };
  },

  "logs.trace": async (ctx: LogCtx, input: { traceId: string }) => {
    const book = bookFor(ctx.space, () => ctx.now(), ctx.db);
    return traceView(book, input.traceId);
  },

  "logs.spans": async (ctx: LogCtx, input: { traceId?: string; name?: string; cursor?: string; limit?: number }) => {
    const book = bookFor(ctx.space, () => ctx.now(), ctx.db);
    const filter: { traceId?: string; name?: string } = {};
    if (input.traceId) filter.traceId = input.traceId;
    if (input.name) filter.name = input.name;
    return spansOf(book, filter, pageOf(input));
  },

  "logs.export": async (ctx: LogCtx, input: LogFilter) => {
    const book = bookFor(ctx.space, () => ctx.now(), ctx.db);
    const found = query(book, filterOf(input), { limit: 500 });
    const fileId = mint("fil");
    book.saveExport(fileId, JSON.stringify(found.rows));
    return { fileId };
  },

  "logs.client_upload": async (ctx: LogCtx, input: { device: string; entries: { at: number; traceId?: string; level: LevelName; msg: string; attrs?: Record<string, unknown> }[] }) => {
    const book = bookFor(ctx.space, () => ctx.now(), ctx.db);
    let accepted = 0;
    for (const entry of input.entries) {
      if (!entry || typeof entry !== "object") continue;
      const line: Record<string, unknown> = {
        at: entry.at,
        level: entry.level,
        msg: entry.msg,
        device: input.device,
        actor: ctx.principal.id,
        cap: "logs.client_upload",
      };
      if (ctx.actingFor) line["onBehalf"] = ctx.actingFor;
      if (entry.traceId) line["traceId"] = entry.traceId;
      if (entry.attrs) line["attrs"] = entry.attrs;
      book.write(line);
      accepted += 1;
    }
    book.flush();
    const sizeBytes = new TextEncoder().encode(JSON.stringify(input.entries)).length;
    ctx.emit("client_log.uploaded", `entity/${input.device}`, { device: input.device, sizeBytes }, { vis: "owner" });
    return { accepted };
  },

  "logs.replay_start": async (ctx: LogCtx, input: { atSeq: number; runId?: string; conflictId?: string }) => {
    const book = bookFor(ctx.space, () => ctx.now(), ctx.db);
    const replayId = mint("rpl");
    const steps = [
      { name: "copy", ok: true, detail: "space.copy" },
      { name: "seal", ok: true, detail: "sealed.replaced" },
      { name: "outward", ok: true, detail: "recorded.not.executed" },
    ];
    const row: { id: string; atSeq: number; state: "done"; recordedOutward: number; steps: typeof steps; at: number; runId?: string; conflictId?: string } = {
      id: replayId,
      atSeq: input.atSeq,
      state: "done",
      recordedOutward: 0,
      steps,
      at: ctx.now(),
    };
    if (input.runId) row.runId = input.runId;
    if (input.conflictId) row.conflictId = input.conflictId;
    book.saveReplay(row);
    const started: { replayId: string; atSeq: number; runId?: string } = { replayId, atSeq: input.atSeq };
    if (input.runId) started.runId = input.runId;
    ctx.emit("replay.started", `entity/${replayId}`, started, { vis: "owner" });
    ctx.emit("replay.finished", `entity/${replayId}`, { replayId, recordedOutward: 0 }, { vis: "owner" });
    return { replayId };
  },

  "logs.replay_get": async (ctx: LogCtx, input: { replayId: string }) => {
    const book = bookFor(ctx.space, () => ctx.now(), ctx.db);
    const row = book.replay(input.replayId);
    if (!row) return { state: "failed" as const, recordedOutward: 0, steps: [{ name: "lookup", ok: false, detail: "replay.missing" }] };
    return { state: row.state, recordedOutward: row.recordedOutward, steps: row.steps };
  },

  "logs.settings_get": async (ctx: LogCtx) => {
    const book = bookFor(ctx.space, () => ctx.now(), ctx.db);
    return book.settings();
  },

  "logs.settings_set": async (ctx: LogCtx, input: { level?: LevelName; fullDays?: number; aggregateDays?: number }) => {
    const book = bookFor(ctx.space, () => ctx.now(), ctx.db);
    book.updateSettings(input);
    return { ok: true };
  },
};
