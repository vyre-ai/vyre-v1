// Report a problem, server half of the client (spec 4.18, b9; ARCH 7.14).
//
// preview builds exactly what would leave the Space: the context, the trace ids of the person's last 20 actions, recent events, versions and the note,
// with every sealed and Restricted value of the view removed. submit stores the report, opens a Review task for the admins ("Problem report from Omar")
// and, when the Space policy reports.vyre is On, posts the same redacted bundle to reports.vyre.run. Ask leaves the posting to an admin, Off keeps the
// report in the Space. The policy changes the destination only: the bundle is built and redacted the same way for all three.
//
// Redaction never trusts the client: the bundle a client sends to submit is scrubbed again here before it is stored or sent.
// A value is removed wherever it appears in a string of the bundle, ignoring case, and also in its digits-only form when it has punctuation (a phone
// number typed with dashes). The window screenshot is dropped whenever the view holds any sealed or Restricted value, because pixels cannot be scrubbed.

import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { ERROR_CODES, VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { ErrorCode, NextStep, VyreError } from "../../../packages/contracts/src/types.ts";

/** The part of the host Ctx the reports handlers use. The full Ctx satisfies it. */
export type ReportsCtx = Pick<Ctx, "space" | "principal" | "actingFor" | "trace" | "now" | "db" | "emit" | "call" | "authorize">;

// ---- the drivers the host supplies

export interface ReportContext { place: string; itemId?: string; hash?: string }
export interface ReportEvent { type: string; at: number; traceId?: string }
export interface ReportVersions { app: string; server: string; device: string }
export interface ReportError { code: string; message: string; at: number; traceId?: string }

export interface ReportSources {
  /** The trace ids of the person's last actions (newest first), the recent events and errors, and the versions, from the host's ring buffers. */
  recent(ctx: ReportsCtx): Promise<{ traceIds: string[]; events: ReportEvent[]; versions: ReportVersions; errors?: ReportError[]; clientLogFileId?: string }>;
  /** The sealed and Restricted values in the view the report is made from: rows, vault values, anything the reporter's clearance does not cover or the label forbids sending. */
  sensitiveValues(ctx: ReportsCtx, context: ReportContext): Promise<string[]>;
  /** The reporter's name for the task title. */
  reporterName?(ctx: ReportsCtx): Promise<string>;
}

export interface ReportsService {
  /** POST the redacted bundle to reports.vyre.run, signed with the host's Ed25519 key. Throws an error with code "rate_limit" when the service says to slow down. */
  post(req: { reportId: string; space: string; reporter: string; title: string; bundle: Bundle }): Promise<{ issueNumber?: number; stored: boolean }>;
  /** Is the service reachable, and is this host's key registered with it? */
  ping(): Promise<{ keyRegistered: boolean }>;
}

export interface ReportsDrivers { sources: ReportSources; service: ReportsService }

let drivers: ReportsDrivers | null = null;
/** Wire (or, with null, unwire) the host drivers. */
export function configureReports(d: ReportsDrivers | null): void {
  drivers = d;
}

// ---- errors and small readers

const NEXT_LABEL: Record<NextStep["kind"], string> = {
  retry: "Try again", switch_model: "Use another model", use_backup_key: "Use the backup key", ask_access: "Ask for access",
  open_settings: "Open settings", reconnect: "Reconnect", edit_input: "Change what you sent", wait: "Wait a moment",
  contact_admin: "Contact an admin", report: "Report a problem",
};

/** Throw a typed error from the global catalogue with the trace id and the catalogue's next steps. */
export function failWith(traceId: string, code: ErrorCode, message?: string, details?: Record<string, unknown>): never {
  const def = ERROR_CODES.find((e) => e.code === code) ?? ERROR_CODES.find((e) => e.code === "internal.unexpected");
  if (!def) throw new Error("error catalogue is empty");
  const error: VyreError = {
    code: def.code, message: message ?? def.what, retryable: def.retryable, traceId,
    next: def.next.map((kind) => ({ kind, label: NEXT_LABEL[kind] })),
  };
  if (details) error.details = details;
  throw new VyreErr(error);
}

export type Row = Record<string, unknown>;
export const asRow = (v: unknown): Row | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : null);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function mint(prefix: string): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(9));
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `${prefix}_${hex}`;
}

export function need(ctx: ReportsCtx): ReportsDrivers {
  if (!drivers) return failWith(ctx.trace.traceId, "internal.unavailable", "Problem reports are not available on this server yet.", { service: "reports" });
  return drivers;
}

// ---- the bundle and its redaction

export interface Bundle {
  context: ReportContext;
  traceIds: string[];
  events: ReportEvent[];
  versions: ReportVersions;
  screenshotFileId?: string;
  errors?: ReportError[];
  /** the local client log, as a file; logs hold ids and metadata only, never content */
  clientLogFileId?: string;
  note?: string;
}

export type Policy = "on" | "ask" | "off";
export const POLICIES: readonly Policy[] = ["on", "ask", "off"];
const isPolicy = (v: unknown): v is Policy => v === "on" || v === "ask" || v === "off";
export const POLICY_KEY = "reports.vyre";
export const MAX_TRACES = 20;
export const MAX_NOTE = 500;
export const MAX_ERRORS = 50;
export const REDACTED = "[removed]";
/** Values shorter than this are matched only as whole words; longer ones anywhere in a string. */
const SHORT = 4;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A scrubber for a set of sensitive values. Longest values first so a value inside another is not left half removed. */
export function scrubber(values: readonly string[]): { scrub(text: string): string; count: number; any: boolean; reset(): void } {
  const clean = [...new Set(values.filter((v) => typeof v === "string" && v.trim().length > 0).map((v) => v.trim()))].sort((a, b) => b.length - a.length);
  const patterns: RegExp[] = [];
  for (const v of clean) {
    patterns.push(v.length < SHORT ? new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(v)}(?![\\p{L}\\p{N}])`, "giu") : new RegExp(escapeRe(v), "giu"));
    // the same value typed another way: the digits alone when it is a formatted number
    const digits = v.replace(/\D/g, "");
    if (digits.length >= 6 && digits !== v) patterns.push(new RegExp(digits, "g"));
  }
  const state = { count: 0 };
  return {
    scrub(text) {
      let out = text;
      for (const re of patterns) out = out.replace(re, () => { state.count += 1; return REDACTED; });
      return out;
    },
    get count() { return state.count; },
    any: clean.length > 0,
    reset() { state.count = 0; },
  };
}

const TRACE = /^[0-9a-f]{32}$/;

/**
 * The bundle with every string scrubbed and the shape forced to what the manifest allows: at most 20 trace ids (each a trace id), a note of at most 500
 * characters, no screenshot when the view holds sensitive values. Returns the number of removals.
 */
export function redactBundle(input: Bundle, values: readonly string[]): { bundle: Bundle; redactions: number } {
  const s = scrubber(values);
  const context: ReportContext = { place: s.scrub(input.context.place) };
  if (input.context.itemId !== undefined) context.itemId = s.scrub(input.context.itemId);
  if (input.context.hash !== undefined) context.hash = s.scrub(input.context.hash);
  const bundle: Bundle = {
    context,
    traceIds: input.traceIds.filter((t) => TRACE.test(t)).slice(0, MAX_TRACES),
    events: input.events.map((e) => ({ type: s.scrub(e.type), at: e.at, ...(e.traceId !== undefined && TRACE.test(e.traceId) ? { traceId: e.traceId } : {}) })),
    versions: { app: s.scrub(input.versions.app), server: s.scrub(input.versions.server), device: s.scrub(input.versions.device) },
  };
  if (input.errors !== undefined) {
    bundle.errors = input.errors.slice(0, MAX_ERRORS).map((e) => ({ code: s.scrub(e.code), message: s.scrub(e.message), at: e.at, ...(e.traceId !== undefined && TRACE.test(e.traceId) ? { traceId: e.traceId } : {}) }));
  }
  if (input.clientLogFileId !== undefined) bundle.clientLogFileId = input.clientLogFileId;
  let extra = 0;
  if (input.screenshotFileId !== undefined) {
    if (s.any) extra = 1;   // pixels cannot be scrubbed, so a view with sensitive values sends no screenshot
    else bundle.screenshotFileId = input.screenshotFileId;
  }
  if (input.note !== undefined) bundle.note = s.scrub(input.note).slice(0, MAX_NOTE);
  return { bundle, redactions: s.count + extra };
}

/** Every string leaf of a bundle (used by tests and by the final check before anything is sent). */
export function leaves(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) leaves(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) leaves(x, out);
  return out;
}

function toBundle(v: unknown): Bundle | null {
  const r = asRow(v);
  const c = asRow(r?.["context"]);
  const ver = asRow(r?.["versions"]);
  const place = str(c?.["place"]);
  if (!r || !c || !ver || !place) return null;
  const events: ReportEvent[] = [];
  for (const e of Array.isArray(r["events"]) ? (r["events"] as unknown[]) : []) {
    const x = asRow(e);
    const type = str(x?.["type"]);
    if (x && type) events.push({ type, at: num(x["at"]), ...(str(x["traceId"]) ? { traceId: str(x["traceId"])! } : {}) });
  }
  const context: ReportContext = { place };
  if (str(c["itemId"])) context.itemId = str(c["itemId"])!;
  if (str(c["hash"])) context.hash = str(c["hash"])!;
  const bundle: Bundle = {
    context,
    traceIds: (Array.isArray(r["traceIds"]) ? (r["traceIds"] as unknown[]) : []).filter((t): t is string => typeof t === "string"),
    events,
    versions: { app: str(ver["app"]) ?? "", server: str(ver["server"]) ?? "", device: str(ver["device"]) ?? "" },
  };
  if (str(r["screenshotFileId"])) bundle.screenshotFileId = str(r["screenshotFileId"])!;
  if (str(r["clientLogFileId"])) bundle.clientLogFileId = str(r["clientLogFileId"])!;
  if (Array.isArray(r["errors"])) {
    const errors: ReportError[] = [];
    for (const e of r["errors"] as unknown[]) {
      const x = asRow(e);
      const code = str(x?.["code"]), message = typeof x?.["message"] === "string" ? x["message"] : undefined;
      if (x && code && message !== undefined) errors.push({ code, message, at: num(x["at"]), ...(str(x["traceId"]) ? { traceId: str(x["traceId"])! } : {}) });
    }
    bundle.errors = errors;
  }
  if (typeof r["note"] === "string") bundle.note = r["note"];
  return bundle;
}

// ---- rows

export interface ReportRow { reportId: string; title: string; status: string; reporter: string; at: number; traceIds: string[]; bundle: Bundle; redactions: number; taskId?: string; issueNumber?: number; sentAt?: number; fixedIn?: string }

function rowOf(r: unknown): ReportRow | null {
  const x = asRow(r);
  const reportId = str(x?.["report_id"]);
  if (!x || !reportId) return null;
  let bundle: Bundle | null = null;
  try { bundle = toBundle(JSON.parse(String(x["bundle_json"]))); } catch { bundle = null; }
  if (!bundle) return null;
  let traceIds: string[] = [];
  try { const t = JSON.parse(String(x["trace_ids"])) as unknown; if (Array.isArray(t)) traceIds = t.filter((v): v is string => typeof v === "string"); } catch { /* none */ }
  const taskId = str(x["task_id"]), fixedIn = str(x["fixed_in"]);
  const issue = x["issue_number"], sent = x["sent_at"];
  return {
    reportId, title: str(x["title"]) ?? "", status: str(x["status"]) ?? "new", reporter: str(x["reporter"]) ?? "", at: num(x["at"]), traceIds, bundle, redactions: num(x["redactions"]),
    ...(taskId ? { taskId } : {}), ...(typeof issue === "number" ? { issueNumber: issue } : {}), ...(typeof sent === "number" ? { sentAt: sent } : {}), ...(fixedIn ? { fixedIn } : {}),
  };
}

export function findReport(ctx: ReportsCtx, reportId: string): ReportRow | null {
  return rowOf(ctx.db.all("SELECT * FROM reports_client_report WHERE report_id = ?", reportId)[0]);
}

const isAdmin = (ctx: ReportsCtx): boolean => ctx.authorize({ perm: "policy.manage", level: "view" }, { type: "space", id: null }).effect === "allow";

async function readPolicy(ctx: ReportsCtx): Promise<Policy> {
  try {
    const row = asRow(asRow(await ctx.call("settings.get" as never, { key: POLICY_KEY }))?.["row"]);
    return isPolicy(row?.["value"]) ? row["value"] : "on";
  } catch {
    return "on";   // the default of the setting
  }
}

// ---- handlers

export async function preview(ctx: ReportsCtx, input: { context: ReportContext; note?: string }) {
  const d = need(ctx);
  const recent = await d.sources.recent(ctx);
  const values = await d.sources.sensitiveValues(ctx, input.context);
  const raw: Bundle = {
    context: input.context, traceIds: recent.traceIds, events: recent.events, versions: recent.versions,
    ...(recent.errors !== undefined ? { errors: recent.errors } : {}), ...(recent.clientLogFileId !== undefined ? { clientLogFileId: recent.clientLogFileId } : {}),
    ...(input.note !== undefined ? { note: input.note } : {}),
  };
  const { bundle, redactions } = redactBundle(raw, values);
  return { bundle, redactions };
}

export async function submit(ctx: ReportsCtx, input: { bundle: unknown }) {
  const d = need(ctx);
  const sent = toBundle(input.bundle);
  if (!sent) return failWith(ctx.trace.traceId, "validation.bad_input", "The report is missing its context or versions.", { errors: ["bundle: incomplete"] });
  const values = await d.sources.sensitiveValues(ctx, sent.context);
  const { bundle, redactions } = redactBundle(sent, values);
  const reportId = mint("rpt");
  const name = (await d.sources.reporterName?.(ctx).catch(() => undefined)) ?? ctx.principal.id;
  const title = `Problem report from ${name}`;

  // the Review task the admins find in Needs you
  const policy = await readPolicy(ctx);
  const summary = [bundle.note ? `"${bundle.note}"` : "No note.", `Where: ${bundle.context.place}.`, policy === "ask" ? "Send it to the Vyre team? Open the report and choose Send." : policy === "off" ? "It stays in this Space." : "It was sent to the Vyre team."].join(" ");
  const made = asRow(await ctx.call("tasks.create" as never, {
    idempotencyKey: `reports.submit:${reportId}:review-task`,
    kind: "review", title, summary, why: "A person reported a problem.", assigned: { kind: "role", id: "admin" }, source: { kind: "manual", id: reportId },
  }));
  const taskId = str(asRow(made?.["task"])?.["id"]);
  if (!taskId) return failWith(ctx.trace.traceId, "internal.unexpected", "The review task for the report could not be made.");

  ctx.db.run(
    "INSERT INTO reports_client_report (report_id, title, status, reporter, at, trace_ids, bundle_json, redactions, task_id, issue_number, sent_at, fixed_in) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    reportId, title, "new", ctx.principal.id, ctx.now(), JSON.stringify(bundle.traceIds), JSON.stringify(bundle), redactions, taskId, null, null, null,
  );
  ctx.emit("report.submitted" as never, `entity/${reportId}`, { reportId, by: ctx.principal.id, traceIds: bundle.traceIds });

  // On posts now, through the capability so it is its own audited call; Ask and Off keep the report here. A failed post does not lose the report.
  let sentToVyre = false;
  if (policy === "on") {
    try {
      const out = asRow(await ctx.call("reports.send_to_vyre" as never, { reportId, idempotencyKey: `reports.submit:${reportId}:send` }));
      sentToVyre = out?.["stored"] === true;
    } catch { /* the report and its task exist; an admin can send it from the report page */ }
  }
  return { reportId, taskId, sentToVyre };
}

export async function send_to_vyre(ctx: ReportsCtx, input: { reportId: string }) {
  const d = need(ctx);
  const report = findReport(ctx, input.reportId);
  if (!report) return failWith(ctx.trace.traceId, "validation.not_found", "There is no report with that id.", { reportId: input.reportId });
  if (report.issueNumber !== undefined || report.status !== "new") return { ...(report.issueNumber !== undefined ? { issueNumber: report.issueNumber } : {}), stored: true };
  if ((await readPolicy(ctx)) === "off") return { stored: false };
  // a last check before anything leaves: the stored bundle was scrubbed at submit, and the values of its view are removed again in case the Space learned new ones
  const values = await d.sources.sensitiveValues(ctx, report.bundle.context);
  const { bundle } = redactBundle(report.bundle, values);
  let out;
  try {
    out = await d.service.post({ reportId: report.reportId, space: ctx.space, reporter: report.reporter, title: report.title, bundle });
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    if (code === "rate_limit" || code === "rate_limit.exceeded") return failWith(ctx.trace.traceId, "rate_limit.exceeded", "The Vyre team's report service asked to slow down. The report is kept and can be sent again in a little while.");
    return failWith(ctx.trace.traceId, "provider.unavailable", "The Vyre team's report service could not be reached. The report is kept and can be sent again.");
  }
  ctx.db.run("UPDATE reports_client_report SET status = ?, sent_at = ?, issue_number = ? WHERE report_id = ?", "sent", ctx.now(), out.issueNumber ?? null, report.reportId);
  ctx.emit("report.sent_to_vyre" as never, `entity/${report.reportId}`, { reportId: report.reportId, ...(out.issueNumber !== undefined ? { issueNumber: out.issueNumber } : {}) });
  return { ...(out.issueNumber !== undefined ? { issueNumber: out.issueNumber } : {}), stored: out.stored };
}

export async function list(ctx: ReportsCtx, input: { cursor?: string; limit?: number }) {
  const offset = typeof input.cursor === "string" && /^\d+$/.test(input.cursor) ? Number(input.cursor) : 0;
  const size = typeof input.limit === "number" && input.limit >= 1 ? Math.min(Math.floor(input.limit), 500) : 50;
  const admin = isAdmin(ctx);
  const rows = admin
    ? ctx.db.all("SELECT * FROM reports_client_report ORDER BY at DESC LIMIT ? OFFSET ?", size, offset)
    : ctx.db.all("SELECT * FROM reports_client_report WHERE reporter = ? ORDER BY at DESC LIMIT ? OFFSET ?", ctx.principal.id, size, offset);
  const total = num(asRow(admin ? ctx.db.all("SELECT COUNT(*) AS n FROM reports_client_report")[0] : ctx.db.all("SELECT COUNT(*) AS n FROM reports_client_report WHERE reporter = ?", ctx.principal.id)[0])?.["n"]);
  const reports = rows.map(rowOf).filter((r): r is ReportRow => r !== null).map((r) => ({ reportId: r.reportId, title: r.title, status: r.status, at: r.at, ...(r.issueNumber !== undefined ? { issueNumber: r.issueNumber } : {}) }));
  return { reports, ...(offset + size < total ? { next: String(offset + size) } : {}), total };
}

export async function get(ctx: ReportsCtx, input: { reportId: string }) {
  const report = findReport(ctx, input.reportId);
  // someone else's report does not exist as far as a non-admin can tell
  if (!report || (report.reporter !== ctx.principal.id && !isAdmin(ctx))) return failWith(ctx.trace.traceId, "permission.not_found", "Not found or not visible.", { reportId: input.reportId });
  return { reportId: report.reportId, bundle: report.bundle, status: report.status, ...(report.issueNumber !== undefined ? { issueNumber: report.issueNumber } : {}) };
}

/** Inbound from reports.vyre.run: the issue closed. Only a report this Space sent, with the issue number it was given, can be resolved. */
export async function resolved(ctx: ReportsCtx, input: { reportId: string; issueNumber: number; fixedIn?: string }) {
  const report = findReport(ctx, input.reportId);
  if (!report) return failWith(ctx.trace.traceId, "validation.not_found", "There is no report with that id.", { reportId: input.reportId });
  if (report.issueNumber === undefined || report.issueNumber !== input.issueNumber) return failWith(ctx.trace.traceId, "validation.precondition_failed", "That issue number is not the one this report was sent as.", { reportId: input.reportId });
  if (report.status === "resolved") return { ok: true };
  ctx.db.run("UPDATE reports_client_report SET status = ?, fixed_in = ? WHERE report_id = ?", "resolved", input.fixedIn ?? null, report.reportId);
  ctx.emit("report.resolved" as never, `entity/${report.reportId}`, { reportId: report.reportId, issueNumber: input.issueNumber, ...(input.fixedIn !== undefined ? { fixedIn: input.fixedIn } : {}) });
  return { ok: true };
}

export async function policy_get(ctx: ReportsCtx, _input: Record<string, unknown>) {
  return { policy: await readPolicy(ctx) };
}

export async function policy_set(ctx: ReportsCtx, input: { policy: string }) {
  if (!isPolicy(input.policy)) return failWith(ctx.trace.traceId, "validation.bad_input", "Choose On, Ask or Off.", { errors: ["policy: not a policy"] });
  await ctx.call("settings.set" as never, { key: POLICY_KEY, value: input.policy });
  return { ok: true };
}

export async function health(ctx: ReportsCtx, _input: Record<string, unknown>) {
  const d = need(ctx);
  const started = ctx.now();
  try {
    const { keyRegistered } = await d.service.ping();
    const latencyMs = Math.max(0, ctx.now() - started);
    if (!keyRegistered) return { state: "degraded" as const, detail: "reports.vyre.run does not know this server's key yet. Reports wait here until it does.", latencyMs };
    return { state: "healthy" as const, latencyMs };
  } catch (e) {
    return { state: "down" as const, detail: `reports.vyre.run cannot be reached: ${e instanceof Error ? e.message : "unknown error"}. Reports wait here until it can.`, latencyMs: Math.max(0, ctx.now() - started) };
  }
}
