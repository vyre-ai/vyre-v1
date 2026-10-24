// The report bundle a Space sends (reports-client manifest: context, trace ids, events, versions, errors, note), checked field by field.
// The service trusts nothing in it: lengths are capped, trace ids must be 32 hex characters, and every string is later escaped before it
// reaches a GitHub issue.

export interface Bundle {
  context: { place: string; itemId?: string; hash?: string };
  traceIds: string[];
  events: { type: string; at: number; traceId?: string }[];
  versions: { app: string; server: string; device: string };
  errors?: { code: string; message: string; at: number; traceId?: string }[];
  note?: string;
  screenshotFileId?: string;
  clientLogFileId?: string;
}

export interface ReportBody { reportId: string; bundle: Bundle; screenshotPng?: string }

export const MAX_BODY = 4 * 1024 * 1024;
export const MAX_SCREENSHOT = 2 * 1024 * 1024;
const TRACE = /^[0-9a-f]{32}$/;
const REPORT_ID = /^rpt_[a-z0-9]{8,64}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v) ? v : null);

export type Parsed = { ok: true; body: ReportBody } | { ok: false; field: string };

/** The report body, or the first field that is wrong. */
export function parseReport(raw: unknown): Parsed {
  const bad = (field: string): Parsed => ({ ok: false, field });
  if (!isObj(raw)) return bad("body");
  if (typeof raw.reportId !== "string" || !REPORT_ID.test(raw.reportId)) return bad("reportId");
  const b = raw.bundle;
  if (!isObj(b)) return bad("bundle");
  const ctx = b.context;
  if (!isObj(ctx)) return bad("bundle.context");
  const place = text(ctx.place, 200);
  if (place === null || place === "") return bad("bundle.context.place");
  const context: Bundle["context"] = { place };
  if (ctx.itemId !== undefined) { const v = text(ctx.itemId, 200); if (v === null) return bad("bundle.context.itemId"); context.itemId = v; }
  if (ctx.hash !== undefined) { const v = text(ctx.hash, 500); if (v === null) return bad("bundle.context.hash"); context.hash = v; }
  if (!Array.isArray(b.traceIds) || b.traceIds.length > 20 || !b.traceIds.every((x) => typeof x === "string" && TRACE.test(x))) return bad("bundle.traceIds");
  if (!Array.isArray(b.events) || b.events.length > 200) return bad("bundle.events");
  const events: Bundle["events"] = [];
  for (const e of b.events) {
    if (!isObj(e)) return bad("bundle.events");
    const type = text(e.type, 100);
    if (type === null || typeof e.at !== "number" || !Number.isFinite(e.at)) return bad("bundle.events");
    const ev: Bundle["events"][number] = { type, at: e.at };
    if (e.traceId !== undefined) { if (typeof e.traceId !== "string" || !TRACE.test(e.traceId)) return bad("bundle.events"); ev.traceId = e.traceId; }
    events.push(ev);
  }
  const v = b.versions;
  if (!isObj(v)) return bad("bundle.versions");
  const app = text(v.app, 64), server = text(v.server, 64), device = text(v.device, 200);
  if (app === null || server === null || device === null) return bad("bundle.versions");
  const bundle: Bundle = { context, traceIds: [...(b.traceIds as string[])], events, versions: { app, server, device } };
  if (b.errors !== undefined) {
    if (!Array.isArray(b.errors) || b.errors.length > 50) return bad("bundle.errors");
    const errors: NonNullable<Bundle["errors"]> = [];
    for (const e of b.errors) {
      if (!isObj(e)) return bad("bundle.errors");
      const code = text(e.code, 100), message = text(e.message, 1000);
      if (code === null || message === null || typeof e.at !== "number" || !Number.isFinite(e.at)) return bad("bundle.errors");
      const er: NonNullable<Bundle["errors"]>[number] = { code, message, at: e.at };
      if (e.traceId !== undefined) { if (typeof e.traceId !== "string" || !TRACE.test(e.traceId)) return bad("bundle.errors"); er.traceId = e.traceId; }
      errors.push(er);
    }
    bundle.errors = errors;
  }
  if (b.note !== undefined) { const n = text(b.note, 500); if (n === null) return bad("bundle.note"); bundle.note = n; }
  for (const k of ["screenshotFileId", "clientLogFileId"] as const) {
    if (b[k] !== undefined) { const f = text(b[k], 100); if (f === null) return bad(`bundle.${k}`); bundle[k] = f; }
  }
  const body: ReportBody = { reportId: raw.reportId, bundle };
  if (raw.screenshotPng !== undefined) {
    if (typeof raw.screenshotPng !== "string" || raw.screenshotPng.length > Math.ceil((MAX_SCREENSHOT * 4) / 3) + 4 || !/^[A-Za-z0-9_-]+$/.test(raw.screenshotPng)) return bad("screenshotPng");
    body.screenshotPng = raw.screenshotPng;
  }
  return { ok: true, body };
}
