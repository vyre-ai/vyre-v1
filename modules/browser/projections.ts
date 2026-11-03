// Browser connections (lane l-chrome2a): the row, the context the handlers use, and the small helpers they share. One table (migrations/0001_browser.sql); it holds sites and rights, never a credential.
import { fail } from "../../host/src/routes/errors.ts";

export type RunsIn = "chrome" | "computers" | "both";
export type Right = "read" | "act";
export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

/** The part of the host Ctx these handlers use. */
export interface BrowserCtx {
  space: string;
  principal: { kind: string; id: string };
  /** The person an agent acts for. */
  actingFor?: string;
  trace: { traceId: string };
  now(): number;
  db: Db;
  emit(name: string, subject: string, payload: unknown): unknown;
}

export interface SiteRow { id: string; owner: string; host: string; runs_in: RunsIn; rights_json: string; removed: number; at: number; updated_at: number }
export interface RightRow { agentId: string; right: Right }

export const TABLE = "browser_sites";
type Code = Parameters<typeof fail>[0];
export function raise(traceId: string, code: Code, message?: string): never {
  throw fail(code, traceId, message ? { message } : {});
}

export function nid(prefix: string): string {
  const b = new Uint8Array(9);
  crypto.getRandomValues(b);
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return `${prefix}_${s}`;
}

/** "https://App.GoHighLevel.com/x?y" and "app.gohighlevel.com" are the same site. Returns null for what is not a site: no dot (except localhost), an address with a space, a wildcard. */
export function hostOf(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!s || /[\s*]/.test(s)) return null;
  let h = s;
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(s)) { try { h = new URL(s).hostname; } catch { return null; } } else h = s.split(/[/?#]/)[0]!.replace(/:\d+$/, "");
  h = h.replace(/\.$/, "");
  if (!/^[a-z0-9.-]+$/.test(h) || h.startsWith(".") || h.includes("..")) return null;
  return h === "localhost" || h.includes(".") ? h : null;
}

export const rightsOf = (r: SiteRow): RightRow[] => JSON.parse(r.rights_json) as RightRow[];

export function siteOut(r: SiteRow) {
  return { id: r.id, host: r.host, runsIn: r.runs_in, rights: rightsOf(r), at: r.at, updatedAt: r.updated_at };
}
