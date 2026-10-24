// portal extras: helpers shared by portal.file_link and portal.post (spec 3.6 Client portal, ARCH 7.6, 8.4).
// An outside account never becomes a Space principal. These calls run as the site service identity and act only for an active account that is linked to a record,
// and only on what the account's row rules let it see. Existence is not leaked: anything outside the account's view answers permission.not_found.
// @reads ../../migrations/0001_portal_accounts.sql

import { ERROR_CODES, VyreErr } from "../../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../../packages/contracts/src/ctx.ts";
import type { ErrorCode, NextStep, VyreError } from "../../../../packages/contracts/src/types.ts";
import { filterRecords } from "../accounts.ts";
import type { PortalRecord, RowRule } from "../accounts.ts";

export type Row = Record<string, unknown>;

const NEXT: Record<NextStep["kind"], string> = {
  retry: "Try again",
  switch_model: "Switch model",
  use_backup_key: "Use the backup key",
  ask_access: "Ask for access",
  open_settings: "Open settings",
  reconnect: "Reconnect",
  edit_input: "Fix the input",
  wait: "Wait a moment",
  contact_admin: "Contact an admin",
  report: "Report a problem",
};

export function fail(ctx: Ctx, code: ErrorCode, message?: string, details?: Record<string, unknown>): never {
  const def = ERROR_CODES.find((e) => e.code === code) ?? ERROR_CODES.find((e) => e.code === "internal.unexpected");
  if (!def) throw new Error("error catalogue is empty");
  const error: VyreError = {
    code: def.code,
    message: message ?? def.what,
    retryable: def.retryable,
    traceId: ctx.trace.traceId,
    next: def.next.map((kind) => ({ kind, label: NEXT[kind] })),
  };
  if (details) error.details = details;
  throw new VyreErr(error);
}

export const str = (v: unknown): string => (typeof v === "string" ? v : "");
export const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
export const isNull = (v: unknown): boolean => v === null || v === undefined;
export const one = (ctx: Ctx, sql: string, ...args: unknown[]): Row | undefined => (ctx.db.all(sql, ...args) as Row[])[0];
export const many = (ctx: Ctx, sql: string, ...args: unknown[]): Row[] => ctx.db.all(sql, ...args) as Row[];

export function rec(ctx: Ctx, input: unknown): Record<string, unknown> {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) fail(ctx, "validation.bad_input", "The input is not valid.");
  return input as Record<string, unknown>;
}

export function reqStr(ctx: Ctx, o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== "string" || v.length === 0) fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

export function reqInt(ctx: Ctx, o: Record<string, unknown>, key: string, min: number, max: number): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

export interface LinkedAccount {
  id: string;
  siteId: string;
  email: string;
  recordId: string;
  rules: RowRule[];
}

function ruleOf(r: Row): RowRule {
  try {
    const v: unknown = JSON.parse(str(r.rule));
    if (typeof v === "object" && v !== null && !Array.isArray(v)) return v as RowRule;
  } catch {
    // fall through to the bare rule below
  }
  return { recordType: str(r.record_type) };
}

/** An account that may act: it exists, is active (not invited or disabled) and is linked to a record. */
export function linkedAccount(ctx: Ctx, accountId: string): LinkedAccount {
  const a = one(ctx, "SELECT * FROM portal_account WHERE id = ?", accountId);
  if (!a) fail(ctx, "validation.not_found", "That account does not exist.");
  if (a.state === "disabled") fail(ctx, "permission.suspended", "That account is disabled.");
  if (a.state !== "active") fail(ctx, "permission.no_grant", "That account has not finished signing in yet.");
  if (isNull(a.record_id)) fail(ctx, "validation.precondition_failed", "Link this account to a record first.");
  const rules = many(ctx, "SELECT * FROM portal_link WHERE account_id = ?", accountId).sort((x, y) => str(x.record_type).localeCompare(str(y.record_type))).map(ruleOf);
  return { id: str(a.id), siteId: str(a.site_id), email: str(a.email), recordId: str(a.record_id), rules };
}

const isRow = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function asRecord(v: unknown): PortalRecord | null {
  if (!isRow(v) || typeof v.id !== "string" || typeof v.type !== "string" || !isRow(v.fields)) return null;
  return { id: v.id, type: v.type, fields: v.fields };
}

const QUERY_LIMIT = 200;

/**
 * The rows the account may see, read from the records module and cut by the account's rules. A rule without `via` names the linked record itself;
 * a rule with `via` names rows that point at it through that field. A record that cannot be read is simply not visible.
 */
export async function visibleRecords(ctx: Ctx, acct: LinkedAccount): Promise<PortalRecord[]> {
  const rows: PortalRecord[] = [];
  for (const rule of acct.rules) {
    if (rule.via === undefined) {
      try {
        const got = (await ctx.call("records.get", { type: rule.recordType, recordId: acct.recordId })) as { record?: unknown };
        const r = asRecord(got.record);
        if (r) rows.push(r);
      } catch (e) {
        if (!(e instanceof VyreErr) || e.error.code !== "validation.not_found") throw e;
      }
      continue;
    }
    const res = (await ctx.call("records.query", { type: rule.recordType, filter: { and: [{ field: rule.via, op: "eq", value: acct.recordId }] }, limit: QUERY_LIMIT })) as { rows?: unknown };
    for (const raw of Array.isArray(res.rows) ? res.rows : []) {
      const r = asRecord(raw);
      if (r) rows.push(r);
    }
  }
  return filterRecords(acct.rules, acct.recordId, rows);
}

/** Per-account throttle on the portal_attempt table, the same shape sign-in uses. Counts only calls that were accepted. */
export function throttle(ctx: Ctx, bucket: string, max: number, windowMs: number): { bump(): void } {
  const r = one(ctx, "SELECT * FROM portal_attempt WHERE bucket = ?", bucket);
  const now = ctx.now();
  const live = r && now - num(r.window_start) < windowMs ? num(r.count) : 0;
  if (live >= max) fail(ctx, "rate_limit.exceeded", "Too many tries. Wait a few minutes and try again.");
  return {
    bump(): void {
      if (!r) ctx.db.run("INSERT INTO portal_attempt (bucket, count, window_start) VALUES (?, ?, ?)", bucket, 1, now);
      else if (live === 0) ctx.db.run("UPDATE portal_attempt SET count = ?, window_start = ? WHERE bucket = ?", 1, now, bucket);
      else ctx.db.run("UPDATE portal_attempt SET count = ? WHERE bucket = ?", live + 1, bucket);
    },
  };
}
