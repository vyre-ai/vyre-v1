// Backups (spec 5 Backups and export, 2.1, 2.26; ARCH 7.10). Config, list, run, delete, health and the owner export live here, together with the pieces
// restore.ts reuses: the archive format, the targets (S3, a drive or a folder), the sealed wrapper and the tombstone merge.
//
// What a backup holds: one archive per run, `b/<backupId>.vybk`, made of a header (sequence range, head hash, tombstones, entry list with sha256) and the
// Space's files as the host's `source` hands them over (events.db with its chain, blobs). The archive is sealed under the Space key with ctx.seal when the
// setting backup.encrypt is on (the default). Next to it the target keeps `index.vybk` (the list of backups, so a new machine can find them) and
// `tombstones.vybk` (every erasure seen so far). Nothing here imports node:crypto (B3): sealing is ctx.seal, hashing and S3 signing are Web Crypto.
//
// Tombstones outlive backups: erasing a person writes a tombstone, and a restore replays the union of the live tombstones, the target's list and the ones
// inside the archive before the Space opens, so a restore never brings erased data back. After a backup succeeds, older backups that predate the newest
// tombstone are deleted ("erase also purges the next backup rotation", spec 2.26).
//
// The host wires the drivers once (configureBackup): the source of the Space's data, the export sink, the S3 transport and the credentials lookup that goes
// through the Vault filler. Credentials never reach this module's tables: the target stores only the vault item's name.
//
// from vyre 0.6.9 kernel/storage/backends.js (dirBackend, s3Backend, signV4 over Web Crypto) and kernel/storage/indexbackup.js (an index written next to the data, checked on read)

import { accessSync, constants, mkdirSync, readFileSync, renameSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { ERROR_CODES, VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { ErrorCode, NextStep, VyreError } from "../../../packages/contracts/src/types.ts";

/** The part of the host Ctx the backup handlers use. The full Ctx satisfies it. */
export type BackupCtx = Pick<Ctx, "space" | "principal" | "actingFor" | "trace" | "now" | "db" | "emit" | "call" | "seal" | "schedule" | "run" | "authorize">;

// ---- the drivers the host supplies

export interface Tombstone { kind: string; subject: string; at: number }
export interface SnapshotEntry { path: string; bytes: Uint8Array }
export interface SpaceSnapshot { fromSeq: number; toSeq: number; headHash: string; entries: SnapshotEntry[] }
export interface ApplyResult {
  /** events whose hash chain was checked after the data was put back */
  checkedEvents: number;
  /** the chain verified from the first event to the head */
  chainOk: boolean;
  /** tombstones that were re-applied (the data they name was erased again) */
  replayed: number;
}

/** The Space's own data, as the host reads and writes it. */
export interface SpaceSource {
  /** The newest event's sequence number and hash. */
  head(): Promise<{ seq: number; hash: string }>;
  /** A consistent copy of the event log and the blobs. */
  snapshot(): Promise<SpaceSnapshot>;
  /** Every erasure the log has recorded. */
  tombstones(): Promise<Tombstone[]>;
  /**
   * Put a snapshot back and replay `tombstones` over it before anything reads it. "scratch" restores into a throwaway directory and only checks the chain;
   * "live" replaces the Space's data and opens it for traffic once the tombstones are applied.
   */
  restore(snapshot: SpaceSnapshot, tombstones: Tombstone[], mode: "scratch" | "live", traceId?: string): Promise<ApplyResult>;
  /** What the owner may take with them: records, files, shared chats. The host never includes private chats or personal memory; this module enforces that again. */
  exportEntries(): Promise<SnapshotEntry[]>;
  /** The person who owns the Space, from the access layer; only they may take a full export. A source that cannot say refuses every export (fail closed). */
  owner?(): Promise<string>;
  /** The secret values this Space holds (vault items, keys, tokens), so an export can prove none of them is inside. */
  secretValues(): Promise<string[]>;
}

export interface ExportSink { save(name: string, bytes: Uint8Array): Promise<{ fileId: string }> }

export interface BackupTarget {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  del(key: string): Promise<void>;
  /** Throws when the target cannot be written. */
  ping(): Promise<void>;
}

export interface S3Credentials { key: string; secret: string; endpoint?: string }
export type S3Transport = (req: { method: string; url: string; headers: Record<string, string>; body?: Uint8Array }) => Promise<{ status: number; body: Uint8Array }>;

export interface TargetConfig { kind: "s3" | "drive" | "local"; bucket?: string; region?: string; path?: string; vaultName?: string }

export interface BackupDrivers {
  source: SpaceSource;
  exports: ExportSink;
  transport?: S3Transport;
  /** Resolves the S3 credentials stored in the vault item. Goes through the Vault filler, so the secret never lands in a table or a log. */
  credentials?: (vaultName: string) => Promise<S3Credentials>;
  /** Replaces how a target is opened (the host can add more kinds; tests use it for a memory target). */
  openTarget?: (cfg: TargetConfig, ctx: BackupCtx) => Promise<BackupTarget>;
}

let drivers: BackupDrivers | null = null;
/** Wire (or, with null, unwire) the host drivers. */
export function configureBackup(d: BackupDrivers | null): void {
  drivers = d;
}

// ---- errors, ids and small readers

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

const enc = new TextEncoder();
const dec = new TextDecoder();

export const DAY_MS = 86_400_000;
/** The newest backups kept after a run; older ones are rotated out. */
export const KEEP = 14;
export const DEFAULT_SCHEDULE = "0 3 * * *";
const OBJECT_PREFIX = "b/";
const INDEX_KEY = "index.vybk";
const TOMBSTONE_KEY = "tombstones.vybk";
const LIST_DEFAULT = 50;

export function need(ctx: BackupCtx): BackupDrivers {
  if (!drivers) return failWith(ctx.trace.traceId, "internal.unavailable", "Backups are not available on this server yet.", { service: "backup" });
  return drivers;
}

// ---- hashing and signing over Web Crypto (no node:crypto, B3)

const hex = (b: ArrayBuffer | Uint8Array): string => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
const asBuf = (d: Uint8Array | string) => {
  const src = typeof d === "string" ? enc.encode(d) : d;
  const out = new Uint8Array(new ArrayBuffer(src.byteLength));
  out.set(src);
  return out;
};

export async function sha256Hex(d: Uint8Array | string): Promise<string> {
  return hex(await globalThis.crypto.subtle.digest("SHA-256", asBuf(d)));
}

async function hmac(key: Uint8Array | string, data: string): Promise<Uint8Array> {
  const k = await globalThis.crypto.subtle.importKey("raw", asBuf(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", k, asBuf(data)));
}

/** The AWS Signature V4 signing key for a day, region and service (published test vector in tests/run.test.ts). */
export async function signingKey(secret: string, day: string, region: string, service = "s3"): Promise<Uint8Array> {
  return hmac(await hmac(await hmac(await hmac(`AWS4${secret}`, day), region), service), "aws4_request");
}

const uriEnc = (s: string): string => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Headers for one path-style S3 request, signed with AWS Signature V4. */
export async function signV4(o: { method: string; host: string; path: string; payloadHash: string; region: string; key: string; secret: string; headers?: Record<string, string>; now: number }): Promise<Record<string, string>> {
  const amz = new Date(o.now).toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amz.slice(0, 8);
  const h: Record<string, string> = { ...(o.headers ?? {}), host: o.host, "x-amz-date": amz, "x-amz-content-sha256": o.payloadHash };
  const names = Object.keys(h).map((x) => x.toLowerCase()).sort();
  const lower = new Map(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v] as const));
  const canon = [o.method, o.path.split("/").map(uriEnc).join("/"), "", names.map((n) => `${n}:${String(lower.get(n)).trim()}\n`).join(""), names.join(";"), o.payloadHash].join("\n");
  const scope = `${day}/${o.region}/s3/aws4_request`;
  const sts = ["AWS4-HMAC-SHA256", amz, scope, await sha256Hex(canon)].join("\n");
  const sig = hex(await hmac(await signingKey(o.secret, day, o.region), sts));
  h["authorization"] = `AWS4-HMAC-SHA256 Credential=${o.key}/${scope}, SignedHeaders=${names.join(";")}, Signature=${sig}`;
  return h;
}

// ---- targets

const SAFE_KEY = /^[A-Za-z0-9_\-/.]+$/;
function safeKey(k: string): string {
  if (!SAFE_KEY.test(k) || k.split("/").some((p) => p === ".." || p === "." || p === "")) throw new Error("bad key");
  return k;
}

/** A folder: a local disk, a USB or mounted network drive, an attached cloud volume. Writes are atomic (temp file, then rename). */
export function dirTarget(root: string): BackupTarget {
  const at = (k: string): string => join(root, safeKey(k));
  return {
    async put(k, bytes) {
      const f = at(k);
      const tmp = `${f}.${Math.random().toString(16).slice(2, 10)}.tmp`;
      mkdirSync(dirname(f), { recursive: true, mode: 0o700 });
      writeFileSync(tmp, bytes, { mode: 0o600 });
      renameSync(tmp, f);
    },
    async get(k) {
      try { return new Uint8Array(readFileSync(at(k))); } catch (e) { if ((e as { code?: string }).code === "ENOENT") return null; throw e; }
    },
    async del(k) { rmSync(at(k), { force: true }); },
    async ping() {
      mkdirSync(root, { recursive: true, mode: 0o700 });
      accessSync(root, constants.W_OK);
      statfsSync(root);
    },
  };
}

/** S3 or any S3-compatible bucket (SeaweedFS, Garage, MinIO), path-style, every request signed with Signature V4. */
export function s3Target(o: { endpoint: string; bucket: string; region: string; prefix: string; creds: S3Credentials; transport: S3Transport; now: () => number }): BackupTarget {
  const u = new URL(o.endpoint);
  const call = async (method: string, objKey: string, body?: Uint8Array): Promise<{ status: number; body: Uint8Array }> => {
    const p = `/${o.bucket}${objKey ? `/${o.prefix}${objKey}` : ""}`;
    const payload = body ?? new Uint8Array(0);
    const headers = await signV4({ method, host: u.host, path: p, payloadHash: await sha256Hex(payload), region: o.region, key: o.creds.key, secret: o.creds.secret, headers: body ? { "content-length": String(body.length) } : {}, now: o.now() });
    return o.transport({ method, url: `${u.origin}${p.split("/").map(uriEnc).join("/")}`, headers, ...(body ? { body } : {}) });
  };
  return {
    async put(k, bytes) { const r = await call("PUT", safeKey(k), bytes); if (r.status >= 300) throw new Error(`s3 put ${r.status}`); },
    async get(k) { const r = await call("GET", safeKey(k)); if (r.status === 404) return null; if (r.status >= 300) throw new Error(`s3 get ${r.status}`); return r.body; },
    async del(k) { const r = await call("DELETE", safeKey(k)); if (r.status >= 300 && r.status !== 404) throw new Error(`s3 del ${r.status}`); },
    async ping() { const r = await call("HEAD", ""); if (r.status >= 300) throw new Error(`s3 head ${r.status}`); },
  };
}

/** Does the path name a place this module may write to? An absolute path with no `..`. */
export function pathProblem(p: string): string | null {
  if (!isAbsolute(p)) return "Use a full path that starts with a slash.";
  if (p.split(/[\\/]/).includes("..")) return "A path may not go up with ..";
  if (normalize(p) === sep) return "Choose a folder, not the root of the disk.";
  return null;
}

export function parseTarget(v: unknown): TargetConfig | null {
  const r = asRow(v);
  if (!r) return null;
  const kind = r["kind"];
  if (kind !== "s3" && kind !== "drive" && kind !== "local") return null;
  const t: TargetConfig = { kind };
  for (const k of ["bucket", "region", "path", "vaultName"] as const) { const s = str(r[k]); if (s) t[k] = s; }
  return t;
}

export function describeTarget(t: TargetConfig): string {
  return t.kind === "s3" ? `s3://${t.bucket ?? ""}/${t.path ?? ""}`.replace(/\/$/, "") : `${t.kind}:${t.path ?? ""}`;
}

/** Why a target config cannot work, in words for the admin; null when it is complete. */
export function targetProblem(t: TargetConfig): string | null {
  if (t.kind === "s3") {
    if (!t.bucket) return "Name the bucket.";
    if (!t.region) return "Name the region.";
    if (!t.vaultName) return "Choose the Vault item that holds the access key and secret.";
    if (t.path && (t.path.startsWith("/") || t.path.split("/").includes(".."))) return "The folder inside the bucket is a plain name like backups/vyre.";
    return null;
  }
  if (!t.path) return "Choose the folder.";
  return pathProblem(t.path);
}

export async function openTarget(ctx: BackupCtx, cfg: TargetConfig): Promise<BackupTarget> {
  const d = need(ctx);
  if (d.openTarget) return d.openTarget(cfg, ctx);
  const problem = targetProblem(cfg);
  if (problem) return failWith(ctx.trace.traceId, "validation.bad_input", problem);
  if (cfg.kind !== "s3") return dirTarget(cfg.path ?? "");
  if (!d.transport || !d.credentials) return failWith(ctx.trace.traceId, "internal.unavailable", "S3 backups need the server's network and Vault wiring, which is not on yet.", { service: "s3" });
  const creds = await d.credentials(cfg.vaultName ?? "").catch(() => null);
  if (!creds) return failWith(ctx.trace.traceId, "provider.auth_failed", "The Vault item for the backup bucket could not be read.", { vaultName: cfg.vaultName });
  const region = cfg.region ?? "us-east-1";
  const prefix = cfg.path ? `${cfg.path.replace(/\/+$/, "")}/` : "";
  return s3Target({ endpoint: creds.endpoint ?? `https://s3.${region}.amazonaws.com`, bucket: cfg.bucket ?? "", region, prefix, creds, transport: d.transport, now: ctx.now });
}

// ---- the archive

export interface ArchiveHeader {
  v: 1;
  backupId: string;
  at: number;
  fromSeq: number;
  toSeq: number;
  headHash: string;
  tombstones: Tombstone[];
  entries: { path: string; size: number; sha256: string }[];
}

const MAGIC = enc.encode("VYBK1\n");

/** Header, then the entries back to back. The header names each entry's size and sha256, so a changed byte is found on unpack. */
export async function pack(meta: Omit<ArchiveHeader, "v" | "entries">, entries: readonly SnapshotEntry[]): Promise<Uint8Array> {
  const header: ArchiveHeader = { v: 1, ...meta, entries: [] };
  for (const e of entries) header.entries.push({ path: e.path, size: e.bytes.length, sha256: await sha256Hex(e.bytes) });
  const head = enc.encode(JSON.stringify(header));
  const total = MAGIC.length + 4 + head.length + entries.reduce((n, e) => n + e.bytes.length, 0);
  const out = new Uint8Array(total);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(MAGIC.length, head.length);
  out.set(head, MAGIC.length + 4);
  let at = MAGIC.length + 4 + head.length;
  for (const e of entries) { out.set(e.bytes, at); at += e.bytes.length; }
  return out;
}

export async function unpack(bytes: Uint8Array): Promise<{ header: ArchiveHeader; entries: SnapshotEntry[] }> {
  if (bytes.length < MAGIC.length + 4 || !MAGIC.every((b, i) => bytes[i] === b)) throw new Error("not a Vyre backup archive");
  const hl = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(MAGIC.length);
  const start = MAGIC.length + 4;
  if (start + hl > bytes.length) throw new Error("the archive header is cut short");
  const header = JSON.parse(dec.decode(bytes.subarray(start, start + hl))) as ArchiveHeader;
  if (header.v !== 1 || !Array.isArray(header.entries)) throw new Error("unknown archive version");
  let at = start + hl;
  const entries: SnapshotEntry[] = [];
  for (const e of header.entries) {
    if (at + e.size > bytes.length) throw new Error(`entry ${e.path} is cut short`);
    const slice = bytes.slice(at, at + e.size);
    if ((await sha256Hex(slice)) !== e.sha256) throw new Error(`entry ${e.path} does not match its hash`);
    entries.push({ path: e.path, bytes: slice });
    at += e.size;
  }
  return { header, entries };
}

// ---- the sealed wrapper

const SEAL_SCOPE = "backup";

/** Seal under the Space key (or, with the setting off, write plain) and frame as one JSON document. */
export function wrap(ctx: BackupCtx, plain: Uint8Array, encrypted: boolean): Uint8Array {
  if (!encrypted) return enc.encode(JSON.stringify({ vybk: 1, enc: false, body: Buffer.from(plain).toString("base64") }));
  const sealed = ctx.seal.seal(plain, SEAL_SCOPE);
  return enc.encode(JSON.stringify({ vybk: 1, enc: true, keyId: sealed.keyId, nonce: sealed.nonce, bytes: sealed.bytes }));
}

export function unwrap(ctx: BackupCtx, blob: Uint8Array): Uint8Array {
  const r = asRow(JSON.parse(dec.decode(blob)));
  if (!r || r["vybk"] !== 1) throw new Error("not a Vyre backup object");
  if (r["enc"] === false) return new Uint8Array(Buffer.from(String(r["body"]), "base64"));
  return ctx.seal.unseal({ keyId: String(r["keyId"]), nonce: String(r["nonce"]), bytes: String(r["bytes"]) });
}

export function isEncrypted(blob: Uint8Array): boolean {
  try { return asRow(JSON.parse(dec.decode(blob)))?.["enc"] !== false; } catch { return true; }
}

// ---- config rows

export interface Config { target: TargetConfig | null; schedule: string; enabled: boolean; nextAt: number | null; lastOkAt: number | null }

export function readConfig(ctx: BackupCtx): Config {
  const rows = ctx.db.all("SELECT key, value FROM backup_config");
  const m = new Map<string, string>();
  for (const r of rows) { const x = asRow(r); if (x && typeof x["key"] === "string" && typeof x["value"] === "string") m.set(x["key"], x["value"]); }
  let target: TargetConfig | null = null;
  try { target = parseTarget(JSON.parse(m.get("target") ?? "null")); } catch { target = null; }
  const nextAt = Number(m.get("next_at")), lastOk = Number(m.get("last_ok_at"));
  return {
    target, schedule: m.get("schedule") ?? DEFAULT_SCHEDULE, enabled: m.get("enabled") === "1",
    nextAt: Number.isFinite(nextAt) && m.has("next_at") ? nextAt : null, lastOkAt: Number.isFinite(lastOk) && m.has("last_ok_at") ? lastOk : null,
  };
}

export function writeConfig(ctx: BackupCtx, key: string, value: string): void {
  ctx.db.run("INSERT OR REPLACE INTO backup_config (key, value) VALUES (?, ?)", key, value);
}

/** The setting backup.encrypt (default on). */
export async function encryptOn(ctx: BackupCtx): Promise<boolean> {
  try {
    const row = asRow(asRow(await ctx.call("settings.get" as never, { key: "backup.encrypt" }))?.["row"]);
    return row?.["value"] !== false;
  } catch {
    return true;
  }
}

// ---- cron (five fields, UTC): minute hour day-of-month month day-of-week; * , - and /n

function fieldSet(spec: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) return null;
    const step = m[2] ? Number(m[2]) : 1;
    if (step < 1) return null;
    let lo = min, hi = max;
    if (m[1] !== "*") {
      const [a, b] = m[1]!.split("-");
      lo = Number(a);
      hi = b === undefined ? (m[2] ? max : lo) : Number(b);
    }
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export interface Cron { minute: Set<number>; hour: Set<number>; dom: Set<number>; month: Set<number>; dow: Set<number>; domAny: boolean; dowAny: boolean }

export function parseCron(line: string): Cron | null {
  const f = line.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const minute = fieldSet(f[0]!, 0, 59), hour = fieldSet(f[1]!, 0, 23), dom = fieldSet(f[2]!, 1, 31), month = fieldSet(f[3]!, 1, 12), dow = fieldSet(f[4]!.replace(/7/g, "0"), 0, 6);
  if (!minute || !hour || !dom || !month || !dow) return null;
  return { minute, hour, dom, month, dow, domAny: f[2] === "*", dowAny: f[4] === "*" };
}

/** The first minute after `after` (epoch ms, UTC) that the cron line names, or null when none falls in the next four years. */
export function nextRun(cron: Cron, after: number): number | null {
  const t = new Date(Math.floor(after / 60_000) * 60_000 + 60_000);
  const limit = after + 4 * 366 * DAY_MS;
  while (t.getTime() < limit) {
    if (!cron.month.has(t.getUTCMonth() + 1)) { t.setUTCMonth(t.getUTCMonth() + 1, 1); t.setUTCHours(0, 0, 0, 0); continue; }
    const domOk = cron.dom.has(t.getUTCDate()), dowOk = cron.dow.has(t.getUTCDay());
    const dayOk = cron.domAny || cron.dowAny ? domOk && dowOk : domOk || dowOk;
    if (!dayOk) { t.setUTCDate(t.getUTCDate() + 1); t.setUTCHours(0, 0, 0, 0); continue; }
    if (!cron.hour.has(t.getUTCHours())) { t.setUTCHours(t.getUTCHours() + 1, 0, 0, 0); continue; }
    if (!cron.minute.has(t.getUTCMinutes())) { t.setUTCMinutes(t.getUTCMinutes() + 1, 0, 0); continue; }
    return t.getTime();
  }
  return null;
}

async function armSchedule(ctx: BackupCtx, cfg: Config): Promise<number | null> {
  const cron = parseCron(cfg.schedule);
  const at = cron ? nextRun(cron, ctx.now()) : null;
  if (at === null) return null;
  writeConfig(ctx, "next_at", String(at));
  await ctx.schedule(at, "backup.run" as never, {});
  return at;
}

// ---- index and tombstones on the target

export interface IndexItem { backupId: string; at: number; seq: number; fromSeq: number; sizeBytes: number; kind: string; objectKey: string; headHash: string; encrypted: boolean; tombstones: number; verified: boolean }

export async function readIndex(ctx: BackupCtx, target: BackupTarget): Promise<IndexItem[]> {
  const blob = await target.get(INDEX_KEY);
  if (!blob) return [];
  const doc = asRow(JSON.parse(dec.decode(unwrap(ctx, blob))));
  const rawItems = doc?.["items"];
  const items = Array.isArray(rawItems) ? (rawItems as unknown[]) : [];
  const out: IndexItem[] = [];
  for (const it of items) {
    const r = asRow(it);
    const id = str(r?.["backupId"]);
    if (!r || !id) continue;
    out.push({ backupId: id, at: num(r["at"]), seq: num(r["seq"]), fromSeq: num(r["fromSeq"]), sizeBytes: num(r["sizeBytes"]), kind: str(r["kind"]) ?? "manual", objectKey: str(r["objectKey"]) ?? `${OBJECT_PREFIX}${id}.vybk`, headHash: str(r["headHash"]) ?? "", encrypted: r["encrypted"] !== false, tombstones: num(r["tombstones"]), verified: r["verified"] === true });
  }
  return out;
}

export async function writeIndex(ctx: BackupCtx, target: BackupTarget, items: readonly IndexItem[], encrypted: boolean): Promise<void> {
  await target.put(INDEX_KEY, wrap(ctx, enc.encode(JSON.stringify({ v: 1, items })), encrypted));
}

export function mergeTombstones(...lists: readonly (readonly Tombstone[])[]): Tombstone[] {
  const m = new Map<string, Tombstone>();
  for (const list of lists) {
    for (const t of list) {
      const k = `${t.kind}\u0000${t.subject}`;
      const have = m.get(k);
      if (!have || t.at < have.at) m.set(k, { kind: t.kind, subject: t.subject, at: t.at });
    }
  }
  return [...m.values()].sort((a, b) => a.at - b.at || (a.kind + a.subject < b.kind + b.subject ? -1 : 1));
}

export async function readTombstones(ctx: BackupCtx, target: BackupTarget): Promise<Tombstone[]> {
  const blob = await target.get(TOMBSTONE_KEY);
  if (!blob) return [];
  const doc = asRow(JSON.parse(dec.decode(unwrap(ctx, blob))));
  const rawList = doc?.["tombstones"];
  const list = Array.isArray(rawList) ? (rawList as unknown[]) : [];
  const out: Tombstone[] = [];
  for (const it of list) {
    const r = asRow(it);
    const kind = str(r?.["kind"]), subject = str(r?.["subject"]);
    if (r && kind && subject) out.push({ kind, subject, at: num(r["at"]) });
  }
  return out;
}

export async function writeTombstones(ctx: BackupCtx, target: BackupTarget, list: readonly Tombstone[], encrypted: boolean): Promise<void> {
  await target.put(TOMBSTONE_KEY, wrap(ctx, enc.encode(JSON.stringify({ v: 1, tombstones: list })), encrypted));
}

// ---- backup rows

export interface Item extends IndexItem { state: string; target: string; reason?: string }

export function itemOf(r: unknown): Item | null {
  const x = asRow(r);
  const id = str(x?.["backup_id"]);
  if (!x || !id) return null;
  const reason = str(x["reason"]);
  return {
    backupId: id, at: num(x["at"]), seq: num(x["seq"]), fromSeq: num(x["from_seq"]), sizeBytes: num(x["size_bytes"]), kind: str(x["kind"]) ?? "manual",
    objectKey: str(x["object_key"]) ?? "", headHash: str(x["head_hash"]) ?? "", encrypted: num(x["encrypted"]) === 1, tombstones: num(x["tombstones"]),
    verified: num(x["verified"]) === 1, state: str(x["state"]) ?? "done", target: str(x["target"]) ?? "", ...(reason ? { reason } : {}),
  };
}

export function doneItems(ctx: BackupCtx): Item[] {
  return ctx.db.all("SELECT * FROM backup_item WHERE state = ? ORDER BY at DESC", "done").map(itemOf).filter((i): i is Item => i !== null);
}

export function findItem(ctx: BackupCtx, backupId: string): Item | null {
  const r = ctx.db.all("SELECT * FROM backup_item WHERE backup_id = ?", backupId)[0];
  const item = itemOf(r);
  return item && item.state === "done" ? item : null;
}

function saveItem(ctx: BackupCtx, i: Item): void {
  ctx.db.run(
    "INSERT OR REPLACE INTO backup_item (backup_id, at, state, kind, seq, from_seq, size_bytes, verified, target, object_key, head_hash, encrypted, tombstones, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    i.backupId, i.at, i.state, i.kind, i.seq, i.fromSeq, i.sizeBytes, i.verified ? 1 : 0, i.target, i.objectKey, i.headHash, i.encrypted ? 1 : 0, i.tombstones, i.reason ?? null,
  );
}

/** A backup the local table does not know (a new machine): take it from the target's index. */
export async function findItemOrIndex(ctx: BackupCtx, target: BackupTarget, backupId: string, label: string): Promise<Item | null> {
  const local = findItem(ctx, backupId);
  if (local) return local;
  const found = (await readIndex(ctx, target)).find((i) => i.backupId === backupId);
  if (!found) return null;
  const item: Item = { ...found, state: "done", target: label };
  saveItem(ctx, item);
  return item;
}

export function markVerified(ctx: BackupCtx, backupId: string): void {
  ctx.db.run("UPDATE backup_item SET verified = ? WHERE backup_id = ?", 1, backupId);
}

// ---- run

export type Kind = "scheduled" | "manual" | "pre_update";

/**
 * Take a backup now. A pre-flight problem (no target) throws. A failure while copying is recorded, emits backup.failed (which health turns into a notice)
 * and answers with the id of the failed attempt, so the event is committed; the attempt is never listed and cannot be restored.
 */
export async function runBackup(ctx: BackupCtx, kind: Kind): Promise<{ backupId: string; ok: boolean; reason?: string }> {
  const d = need(ctx);
  const cfg = readConfig(ctx);
  if (!cfg.target) return failWith(ctx.trace.traceId, "validation.precondition_failed", "Choose where backups go first.");
  const label = describeTarget(cfg.target);
  const backupId = mint("bkp");
  const at = ctx.now();
  try {
    const target = await openTarget(ctx, cfg.target);
    const encrypted = await encryptOn(ctx);
    const snap = await d.source.snapshot();
    const tombs = mergeTombstones(await d.source.tombstones(), await readTombstones(ctx, target).catch(() => []));
    const archive = await pack({ backupId, at, fromSeq: snap.fromSeq, toSeq: snap.toSeq, headHash: snap.headHash, tombstones: tombs }, snap.entries);
    const blob = wrap(ctx, archive, encrypted);
    const objectKey = `${OBJECT_PREFIX}${backupId}.vybk`;
    await target.put(objectKey, blob);
    const item: Item = { backupId, at, state: "done", kind, seq: snap.toSeq, fromSeq: snap.fromSeq, sizeBytes: blob.length, verified: false, target: label, objectKey, headHash: snap.headHash, encrypted, tombstones: tombs.length };
    saveItem(ctx, item);
    await writeTombstones(ctx, target, tombs, encrypted);
    await rotate(ctx, target, tombs, encrypted, backupId);
    writeConfig(ctx, "last_ok_at", String(at));
    ctx.emit("backup.completed" as never, `entity/${backupId}`, { backupId, seq: snap.toSeq, sizeBytes: blob.length });
    return { backupId, ok: true };
  } catch (e) {
    const reason = e instanceof VyreErr ? e.error.message : e instanceof Error ? e.message : "The backup failed.";
    saveItem(ctx, { backupId, at, state: "failed", kind, seq: 0, fromSeq: 0, sizeBytes: 0, verified: false, target: label, objectKey: "", headHash: "", encrypted: false, tombstones: 0, reason });
    ctx.emit("backup.failed" as never, `entity/${backupId}`, { backupId, reason });
    return { backupId, ok: false, reason };
  }
}

/** Keep the newest KEEP backups and drop any that predate the newest tombstone (erase purges the next rotation); the backup just taken (keepId) always stays. */
async function rotate(ctx: BackupCtx, target: BackupTarget, tombs: readonly Tombstone[], encrypted: boolean, keepId: string): Promise<void> {
  const items = doneItems(ctx);
  const newestErase = tombs.reduce((m, t) => Math.max(m, t.at), 0);
  const drop = items.filter((it, i) => it.backupId !== keepId && (i >= KEEP || it.at < newestErase));
  for (const it of drop) {
    await target.del(it.objectKey).catch(() => undefined);
    ctx.db.run("DELETE FROM backup_item WHERE backup_id = ?", it.backupId);
  }
  await writeIndex(ctx, target, items.filter((it) => !drop.includes(it)), encrypted);
}

// ---- handlers

const page = (cursor: unknown, limit: unknown): { offset: number; size: number } => {
  const offset = typeof cursor === "string" && /^\d+$/.test(cursor) ? Number(cursor) : 0;
  const size = typeof limit === "number" && limit >= 1 ? Math.min(Math.floor(limit), 500) : LIST_DEFAULT;
  return { offset, size };
};

export async function config_get(ctx: BackupCtx, _input: Record<string, unknown>) {
  const cfg = readConfig(ctx);
  return {
    ...(cfg.target ? { target: cfg.target } : {}),
    schedule: cfg.schedule,
    encrypted: await encryptOn(ctx),
    ...(cfg.lastOkAt !== null ? { lastBackupAt: cfg.lastOkAt } : {}),
  };
}

export async function config_set(ctx: BackupCtx, input: { target: unknown; schedule: string; enabled: boolean }) {
  need(ctx);
  const target = parseTarget(input.target);
  if (!target) return failWith(ctx.trace.traceId, "validation.bad_input", "Choose S3, a drive or a folder.");
  const problem = targetProblem(target);
  if (problem) return failWith(ctx.trace.traceId, "validation.bad_input", problem, { errors: [`target: ${problem}`] });
  const cron = parseCron(input.schedule);
  if (!cron) return failWith(ctx.trace.traceId, "validation.bad_input", "The schedule is five fields: minute hour day month weekday, for example 0 3 * * *.", { errors: ["schedule: not a cron line"] });
  // prove the target takes a write before the switch is saved, so a typo shows now and not at 3 in the morning
  try {
    await (await openTarget(ctx, target)).ping();
  } catch (e) {
    if (e instanceof VyreErr) throw e;
    return failWith(ctx.trace.traceId, "provider.unavailable", `The backup target did not accept a test write: ${e instanceof Error ? e.message : "unknown error"}`);
  }
  writeConfig(ctx, "target", JSON.stringify(target));
  writeConfig(ctx, "schedule", input.schedule.trim());
  writeConfig(ctx, "enabled", input.enabled ? "1" : "0");
  if (input.enabled) await armSchedule(ctx, readConfig(ctx));
  else ctx.db.run("DELETE FROM backup_config WHERE key = ?", "next_at");
  ctx.emit("backup.config_changed" as never, `entity/${encodeURIComponent(describeTarget(target))}`, { target: describeTarget(target), schedule: input.enabled ? input.schedule.trim() : "off" });
  return { ok: true };
}

export async function list(ctx: BackupCtx, input: { cursor?: string; limit?: number }) {
  const cfg = readConfig(ctx);
  let items = doneItems(ctx);
  if (items.length === 0 && cfg.target) {
    // a new machine: the list comes from the target's index and is kept locally from then on
    try {
      const target = await openTarget(ctx, cfg.target);
      const label = describeTarget(cfg.target);
      for (const found of await readIndex(ctx, target)) saveItem(ctx, { ...found, state: "done", target: label });
      items = doneItems(ctx);
    } catch { /* an unreachable target shows an empty list; backups.recent says why */ }
  }
  const { offset, size } = page(input.cursor, input.limit);
  const rows = items.slice(offset, offset + size).map((i) => ({ backupId: i.backupId, at: i.at, sizeBytes: i.sizeBytes, seq: i.seq, kind: i.kind, verified: i.verified, target: i.target }));
  const more = offset + size < items.length;
  return { backups: rows, ...(more ? { next: String(offset + size) } : {}), total: items.length };
}

export async function run(ctx: BackupCtx, _input: Record<string, unknown>) {
  const cfg = readConfig(ctx);
  // The scheduler calls this capability as the admin who switched backups on, so a scheduled run looks like a manual one. It is told apart by the
  // clock: a run at or after next_at is the scheduled one, takes the "scheduled" kind and arms the next. Any other run (a button press, a stale job
  // from an earlier schedule, a backup before an update) is manual and never starts a second chain.
  const due = cfg.enabled && cfg.nextAt !== null && ctx.now() >= cfg.nextAt;
  const out = await runBackup(ctx, due ? "scheduled" : "manual");
  if (due) await armSchedule(ctx, readConfig(ctx));
  return { backupId: out.backupId };
}

export async function del(ctx: BackupCtx, input: { backupId: string }) {
  const cfg = readConfig(ctx);
  const item = findItem(ctx, input.backupId);
  if (!item) return failWith(ctx.trace.traceId, "validation.not_found", "There is no backup with that id.", { backupId: input.backupId });
  if (cfg.target) {
    const target = await openTarget(ctx, cfg.target);
    await target.del(item.objectKey);
    ctx.db.run("DELETE FROM backup_item WHERE backup_id = ?", input.backupId);
    await writeIndex(ctx, target, doneItems(ctx), await encryptOn(ctx));
  } else {
    ctx.db.run("DELETE FROM backup_item WHERE backup_id = ?", input.backupId);
  }
  return { deleted: true };
}

export async function health(ctx: BackupCtx, _input: Record<string, unknown>) {
  const cfg = readConfig(ctx);
  if (!cfg.target) return { state: "degraded" as const, detail: "No backup target is set." };
  const started = ctx.now();
  try {
    await (await openTarget(ctx, cfg.target)).ping();
  } catch (e) {
    return { state: "down" as const, detail: `The backup target cannot be written: ${e instanceof Error ? e.message : "unknown error"}`, latencyMs: Math.max(0, ctx.now() - started) };
  }
  const latencyMs = Math.max(0, ctx.now() - started);
  if (cfg.lastOkAt === null) return { state: "degraded" as const, detail: "No backup has finished yet.", latencyMs };
  const ageHours = Math.floor((ctx.now() - cfg.lastOkAt) / 3_600_000);
  const state = ageHours > 72 ? ("down" as const) : ageHours > 30 ? ("degraded" as const) : ("healthy" as const);
  return { state, ageHours, latencyMs, ...(state === "healthy" ? {} : { detail: `The last good backup is ${ageHours} hours old.` }) };
}

// ---- the owner export

/** Paths that are never exported: secrets, keys, and what belongs to one person alone. */
const BLOCKED_PATH = [
  /(^|\/)vault(\/|$)/i, /(^|\/)secrets?(\/|$)/i, /(^|\/)keys?(\/|$)/i, /(^|\/)private(\/|$)/i, /(^|\/)memory\/(personal|mine)(\/|$)/i, /(^|\/)chats\/(private|dm)(\/|$)/i,
  /(^|\/)\.env(\.|$)/i, /\.(pem|key|p12|pfx)$/i, /(^|\/)(id_rsa|id_ed25519)$/i,
];
export const exportBlocked = (path: string): boolean => BLOCKED_PATH.some((re) => re.test(path));

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b: Uint8Array): number => { let c = 0xffffffff; for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** A zip with every entry stored (no compression), so the file is plain to inspect and to test. */
export function zip(entries: readonly SnapshotEntry[], at: number): Uint8Array {
  const d = new Date(at);
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  const date = (Math.max(0, d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: number): number[] => [v & 0xff, (v >>> 8) & 0xff];
  const u32 = (v: number): number[] => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  for (const e of entries) {
    const name = enc.encode(e.path), crc = crc32(e.bytes);
    const local = Uint8Array.from([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(time), ...u16(date), ...u32(crc), ...u32(e.bytes.length), ...u32(e.bytes.length), ...u16(name.length), ...u16(0)]);
    parts.push(local, name, e.bytes);
    central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(time), ...u16(date), ...u32(crc), ...u32(e.bytes.length), ...u32(e.bytes.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += local.length + name.length + e.bytes.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at2 = 0;
  for (const p of all) { out.set(p, at2); at2 += p.length; }
  return out;
}

/** Does `needle` (at least 6 bytes, so a short word does not match everything) appear in the bytes? */
function contains(hay: Uint8Array, needle: string): boolean {
  if (needle.length < 6) return false;
  return Buffer.from(hay.buffer, hay.byteOffset, hay.byteLength).includes(needle);
}

/**
 * Owner full export: a zip of what the Space's people own. Never secret values (vault items, keys, tokens), never other people's private chats or
 * personal memory. The host leaves those out first; this checks the paths again and searches every file for the Space's secret values, and a file that
 * holds one is left out and counted, so the zip cannot carry a secret even if a record field does.
 */
export async function export_start(ctx: BackupCtx, _input: Record<string, unknown>) {
  const d = need(ctx);
  const runId = ctx.run ?? mint("run");
  // A full export is complete or it does not happen: it is never filtered per item (a silently partial export is its own harm). So it is the Space owner's alone, who holds every clearance (P-SEC_07).
  // Fail closed: no authorize, a deny, a hold, or any other person (an admin included) is refused and nothing is packed.
  const refused = (): never => failWith(ctx.trace.traceId, "permission.no_grant", "Only the Space owner can take a full export.");
  if (typeof ctx.authorize !== "function") return refused();
  if (ctx.authorize({ perm: "records.export", level: "manage" }, { type: "space", id: null }).effect !== "allow") return refused();
  if (ctx.principal.kind !== "person" || ctx.principal.id !== (await d.source.owner?.())) return refused();
  const at = ctx.now();
  const secrets = (await d.source.secretValues()).filter((s) => s.length >= 6);
  const keep: SnapshotEntry[] = [];
  let skipped = 0;
  for (const e of await d.source.exportEntries()) {
    if (exportBlocked(e.path) || secrets.some((s) => contains(e.bytes, s) || e.path.includes(s))) { skipped++; continue; }
    keep.push(e);
  }
  const readme = enc.encode(`Vyre export of ${ctx.space}\nTaken ${new Date(at).toISOString()} by ${ctx.principal.id}.\n${keep.length} files. ${skipped} left out (secrets, keys and private items are never exported).\n`);
  const bytes = zip([{ path: "README.txt", bytes: readme }, ...keep], at);
  const saved = await d.exports.save(`vyre-export-${new Date(at).toISOString().slice(0, 10)}.zip`, bytes);
  ctx.db.run(
    "INSERT OR REPLACE INTO backup_export (run_id, at, by_principal, on_behalf, state, file_id, size_bytes, entries, skipped) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    runId, at, ctx.principal.id, ctx.actingFor ?? null, "done", saved.fileId, bytes.length, keep.length, skipped,
  );
  return { runId };
}
