// sources module state and shared helpers: tables (migrations/0001_sources.sql), the delivery signature checks, JSON pointers and the mapping that turns a payload into a row.
// @reads /modules/sources/migrations/0001_sources.sql
import { readFileSync } from "node:fs";
import { canonical } from "../../lib/canonical.ts";
import { evalExpr, parseExpr } from "../../lib/expr/expr.ts";
import { mintUuid } from "../../lib/ids.ts";
import { fail } from "../../host/src/routes/errors.ts";
import { sha256Hex } from "../../kernel/src/log/hash.ts";
import type { Tx } from "../../kernel/src/store/projection.ts";

export type ErrCode = Parameters<typeof fail>[0];
export type Verify = "hmac" | "signature" | "none";
export type SourceState = "active" | "paused" | "failing";
export type DeliveryStatus = "accepted" | "duplicate" | "rejected" | "failed" | "linked_pending";

export interface FieldMap { from: string; to: string; transform?: string }
export interface Mapping { dedupe: string; fields: FieldMap[]; match: string[]; link?: string[] }

export interface ConnectorSourceRow { key: string; path: string; verify: Verify; dedupe?: string; event?: string }
export interface ConnectorRow { key: string; title: string; sources?: ConnectorSourceRow[] }
export interface SourcesRegistry { connectors: ConnectorRow[] }

export interface SourcesDeps {
  tx: Tx;
  registry: SourcesRegistry;
  now?: () => number;
  /** The signing secret held in the Vault under `name` (resolved server side at call time; the module never stores it). */
  secret?: (name: string) => Promise<string | undefined>;
  /** Is the public address reachable (for sources.health). */
  reachable?: () => Promise<boolean>;
  /** Largest accepted body, bytes. */
  maxBodyBytes?: number;
}

export interface SourcesCtx {
  trace: { traceId: string };
  emit(name: string, subject: string, payload: Record<string, unknown>): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
  actor?: string;
}

export const nowOf = (d: Pick<SourcesDeps, "now">): number => (d.now ?? Date.now)();
export const mintShort = (prefix: string, now: number): string => `${prefix}_${mintUuid(now).replaceAll("-", "")}`;

export function refuse(ctx: Pick<SourcesCtx, "trace">, code: ErrCode, message: string, details?: Record<string, unknown>): never {
  throw fail(code, ctx.trace.traceId, { message, ...(details ? { details } : {}) });
}

const ready = new WeakSet<object>();
export function ensureTables(tx: Tx): void {
  if (ready.has(tx)) return;
  tx.exec(readFileSync(new URL("./migrations/0001_sources.sql", import.meta.url), "utf8"));
  ready.add(tx);
}

// ---- HMAC-SHA256 over the kernel's sha256 (modules do not import crypto: boundary B3) ----

const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string): Uint8Array => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const bytes = (v: string | Uint8Array): Uint8Array => (typeof v === "string" ? new TextEncoder().encode(v) : v);

export function hmacSha256Hex(key: string | Uint8Array, message: string | Uint8Array): string {
  let k = bytes(key);
  if (k.length > 64) k = fromHex(sha256Hex(k));
  const ipad = new Uint8Array(64);
  const opad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) { const b = k[i] ?? 0; ipad[i] = b ^ 0x36; opad[i] = b ^ 0x5c; }
  return sha256Hex(opad, fromHex(sha256Hex(ipad, bytes(message))));
}

/** Equal strings in time that does not depend on where they differ. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const b64 = (hex: string): string => btoa(String.fromCharCode(...fromHex(hex)));
/** Headers a plain HMAC signature may arrive in; the value is `<hex>`, `sha256=<hex>` or base64. */
const HMAC_HEADERS = ["x-hub-signature-256", "x-signature-256", "x-vyre-signature", "x-signature", "x-webhook-signature", "x-hook-signature"];
const TOLERANCE_S = 300;

export type VerifyResult = { ok: true } | { ok: false; reason: "bad_signature" };

/** `hmac`: the body signed with the secret. `signature`: timestamped (`stripe-signature: t=...,v1=...` or `x-vyre-timestamp` plus `x-vyre-signature`), signed over `<t>.<body>`, refused outside 5 minutes. */
export function verifyDelivery(scheme: Verify, secret: string, headers: Record<string, string>, body: string, receivedAt: number): VerifyResult {
  if (scheme === "none") return { ok: true };
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v;
  const bad: VerifyResult = { ok: false, reason: "bad_signature" };
  if (scheme === "hmac") {
    const name = HMAC_HEADERS.find((n) => h[n] !== undefined);
    if (!name) return bad;
    const got = h[name]!.trim().replace(/^sha256=/i, "");
    const want = hmacSha256Hex(secret, body);
    return safeEqual(got.toLowerCase(), want) || safeEqual(got, b64(want)) ? { ok: true } : bad;
  }
  let t: string | undefined;
  let sigs: string[] = [];
  if (h["stripe-signature"] !== undefined) {
    const parts = h["stripe-signature"].split(",").map((p) => p.trim().split("="));
    t = parts.find((p) => p[0] === "t")?.[1];
    sigs = parts.filter((p) => p[0] === "v1" && p[1]).map((p) => p[1]!);
  } else if (h["x-vyre-timestamp"] !== undefined && h["x-vyre-signature"] !== undefined) {
    t = h["x-vyre-timestamp"];
    sigs = [h["x-vyre-signature"].replace(/^sha256=/i, "")];
  }
  if (!t || !/^\d+$/.test(t) || !sigs.length) return bad;
  if (Math.abs(receivedAt / 1000 - Number(t)) > TOLERANCE_S) return bad;
  const want = hmacSha256Hex(secret, `${t}.${body}`);
  return sigs.some((s) => safeEqual(s.toLowerCase(), want)) ? { ok: true } : bad;
}

// ---- payloads and mappings ----

/** RFC 6901 pointer lookup. `undefined` when the path is not there. */
export function pointerGet(doc: unknown, pointer: string): unknown {
  if (pointer === "") return doc;
  if (!pointer.startsWith("/")) return undefined;
  let cur: unknown = doc;
  for (const raw of pointer.slice(1).split("/")) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(cur)) { const i = /^\d+$/.test(key) ? Number(key) : -1; cur = cur[i]; }
    else if (cur !== null && typeof cur === "object") cur = (cur as Record<string, unknown>)[key];
    else return undefined;
    if (cur === undefined) return undefined;
  }
  return cur;
}

export const validPointer = (p: string): boolean => p === "" || (p.startsWith("/") && !/~[^01]/.test(p));

/** A JSON body, or a form-encoded one as an object. Throws on anything else. */
export function parseBody(body: string): unknown {
  const t = body.trim();
  if (t.startsWith("{") || t.startsWith("[")) return JSON.parse(t);
  if (t === "") throw new Error("empty body");
  if (!t.includes("=")) throw new Error("not JSON and not a form");
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(t)) out[k] = v;
  return out;
}

export interface Normalised { row: Record<string, unknown>; providerId?: string; missing: string[] }

/** The row a mapping makes from a payload: fields without a value in the payload are left out and named in `missing`. Transforms are small expressions over `value`. */
export function normalise(mapping: Mapping, payload: unknown): Normalised {
  const row: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const f of mapping.fields) {
    let v = pointerGet(payload, f.from);
    if (v === undefined || v === null) { missing.push(f.to); continue; }
    if (f.transform) v = evalExpr(parseExpr(f.transform), { values: { value: v } });
    if (v === null || v === undefined) { missing.push(f.to); continue; }
    row[f.to] = v;
  }
  const id = pointerGet(payload, mapping.dedupe);
  return { row, ...(id !== undefined && id !== null && id !== "" && typeof id !== "object" ? { providerId: String(id) } : {}), missing };
}

/** The first problem with a mapping's shape, or null. Fields of the target type are checked by the caller. */
export function mappingProblem(m: Mapping): string | null {
  if (!validPointer(m.dedupe) || m.dedupe === "") return `dedupe ${m.dedupe} is not a JSON pointer to the provider id`;
  if (!m.fields.length) return "map at least one field";
  const to = new Set<string>();
  for (const f of m.fields) {
    if (!validPointer(f.from)) return `${f.from} is not a JSON pointer`;
    if (!/^[a-z][a-z0-9_]*$/.test(f.to)) return `${f.to} is not a field key`;
    if (to.has(f.to)) return `${f.to} is mapped twice`;
    to.add(f.to);
    if (f.transform) { try { parseExpr(f.transform); } catch (e) { return `the transform for ${f.to} does not parse (${e instanceof Error ? e.message : "error"})`; } }
  }
  for (const k of m.match) if (!to.has(k)) return `match field ${k} is not mapped`;
  for (const k of m.link ?? []) if (!to.has(k)) return `link field ${k} is not mapped`;
  return null;
}

export const DAY = 86_400_000;
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export const same = (a: unknown, b: unknown): boolean => {
  const x = a === undefined ? null : a;
  const y = b === undefined ? null : b;
  if (x === y) return true;
  try { return canonical(x) === canonical(y); } catch { return false; }
};
