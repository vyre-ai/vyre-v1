// Audit projections: the append-only, hash-chained record of access changes and sensitive acts (spec 2.25, ARCH 4.1).
// Rows never hold secret values (scrub), an erase entry records who and when and never what, and a bulk read is one row with a sample of ids.
// The chain: hash = sha-256(prev_hash, canonical row). An edit changes the row's hash, a deletion leaves a gap, a rewrite of the tail disagrees with the signed
// checkpoints, which sign the head with the Space key through a signer the host supplies (the module never holds the private key).
import { AUDIT_TARGET_KINDS } from "../../packages/contracts/src/audit-targets.ts";
import type { AuditTarget } from "../../packages/contracts/src/audit-targets.ts";
import type { Ctx } from "../../packages/contracts/src/ctx.ts";
import { fail } from "../../host/src/routes/errors.ts";
import { sha256Hex } from "../../kernel/src/log/hash.ts";
import { canonical } from "../../kernel/src/seal/wire.ts";
import { verifyCheckpoint } from "../../kernel/src/audit/index.ts";
import type { PublicKey, Signer as KernelSigner } from "../../kernel/src/audit/index.ts";

/** What the host supplies besides ctx: the Space key signer, the archive writer and the export file writer. Each is absent until the host wires it. */
export interface AuditSeams {
  /** Signs checkpoint bytes with the Space checkpoint key; `publicKey` verifies them. */
  signer?: { keyId: string; sign: KernelSigner; publicKey: PublicKey };
  /** Writes (appends) the rows of one year to the encrypted archive file `audit-archive/YYYY.jsonl.zst`. */
  archive?: { write(year: number, lines: string[]): Promise<{ file: string; sizeBytes: number }> };
  /** Saves an export into Files and returns its file id. */
  exports?: { save(name: string, csv: string): Promise<string> };
}
export type AuditCtx = Pick<Ctx, "space" | "principal" | "trace" | "now" | "db" | "emit"> & { authorize?: Ctx["authorize"]; depth?: number } & AuditSeams;

export type Klass = "change" | "sensitive" | "deny" | "admin" | "erase" | "sign_in";
export type Ref = { kind: "person" | "agent" | "actor" | "service"; id: string };
export type ResRef = { type: string; id: string };

export interface RowRec {
  seq: number; id: string; at: number; actor_kind: string; actor_id: string; behalf_kind: string | null; behalf_id: string | null; action: string;
  resource_type: string | null; resource_id: string | null; class: Klass; before_json: string | null; after_json: string | null;
  trace_id: string; request_id: string | null; prev_hash: string; hash: string;
}
export interface CheckpointRec { seq: number; at: number; hash: string; key_id: string; sig: string }

type Code = Parameters<typeof fail>[0];
export function raise(ctx: Pick<AuditCtx, "trace">, code: Code, message?: string): never {
  throw fail(code, ctx.trace.traceId, message ? { message } : {});
}
export function nid(prefix: string): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(9));
  return `${prefix}_${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export const CHUNK = 500;
export const PAGE_DEFAULT = 50;
export const PAGE_MAX = 500;
/** audit.verify checks at most this many rows per call; a longer range is run in slices. */
export const VERIFY_MAX = 100_000;
export const EXPORT_MAX = 100_000;
export const ARCHIVE_MAX = 50_000;
/** A bulk read keeps this many ids as its sample. */
export const SAMPLE_IDS = 20;
/** The newest checkpoint is stale after this long (they are written every 10 minutes). */
export const CHECKPOINT_STALE_MS = 30 * 60_000;
const DETAIL_MAX = 8_000;
const SECRET_KEY = /pass(word|phrase)?|secret|token|private[_-]?key|api[_-]?key|authorization|credential|cookie|seed|recovery/i;

// ---- rows

export const genesis = (space: string): string => sha256Hex(`vyre-genesis:audit:${space}`);

/** The hash of a row: over its previous hash and everything else but its own hash. The stored strings are hashed as stored. */
export function hashOf(r: Omit<RowRec, "hash">): string {
  return sha256Hex(r.prev_hash, canonical({
    seq: r.seq, id: r.id, at: r.at, ak: r.actor_kind, ai: r.actor_id, bk: r.behalf_kind, bi: r.behalf_id, action: r.action, rt: r.resource_type, ri: r.resource_id,
    class: r.class, before: r.before_json, after: r.after_json, trace: r.trace_id, req: r.request_id,
  }));
}

/** Drop secret values: any key that looks like a credential reads "[redacted]"; very large details are replaced by their size. */
export function scrub(v: unknown, depth = 0): unknown {
  if (depth > 8) return "[deep]";
  if (Array.isArray(v)) return v.map((x) => scrub(x, depth + 1));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : scrub(x, depth + 1);
    return out;
  }
  return v;
}
function jsonOf(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = JSON.stringify(scrub(v));
  return s.length > DETAIL_MAX ? JSON.stringify({ truncated: true, bytes: s.length }) : s;
}
/** A bulk read is one row: the first ids as a sample, and how many there were. */
export function sampled(detail: unknown): unknown {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return detail;
  const d = detail as Record<string, unknown>;
  if (!Array.isArray(d["ids"]) || d["ids"].length <= SAMPLE_IDS) return detail;
  return { ...d, ids: d["ids"].slice(0, SAMPLE_IDS), count: d["ids"].length, sampled: true };
}

export function headOf(ctx: AuditCtx): { seq: number; hash: string } {
  const last = ctx.db.all(`SELECT seq, hash FROM audit_row ORDER BY seq DESC LIMIT 1`)[0] as { seq: number; hash: string } | undefined;
  if (last) return last;
  const a = anchorOf(ctx);
  return a ?? { seq: 0, hash: genesis(ctx.space) };
}
export function anchorOf(ctx: AuditCtx): { seq: number; hash: string } | undefined {
  const rows = ctx.db.all(`SELECT k, v FROM audit_meta`) as { k: string; v: string }[];
  const seq = rows.find((r) => r.k === "anchor_seq")?.v;
  const hash = rows.find((r) => r.k === "anchor_hash")?.v;
  return seq !== undefined && hash !== undefined ? { seq: Number(seq), hash } : undefined;
}
function setMeta(ctx: AuditCtx, k: string, v: string): void {
  if (ctx.db.all(`SELECT k FROM audit_meta WHERE k = ?`, k).length > 0) ctx.db.run(`UPDATE audit_meta SET v = ? WHERE k = ?`, v, k);
  else ctx.db.run(`INSERT INTO audit_meta (k, v) VALUES (?, ?)`, k, v);
}

export interface NewRow {
  actor: Ref; onBehalfOf?: Ref | undefined; action: string; class: Klass; resource?: ResRef | undefined; before?: unknown; after?: unknown; targets?: readonly AuditTarget[]; requestId?: string | undefined;
}
/** Append one row to the chain. `id` is for seeding; the pipeline and audit.append take a fresh one. */
export function appendRow(ctx: AuditCtx, n: NewRow, id?: string): { auditId: string; seq: number } {
  const head = headOf(ctx);
  const erased = n.class === "erase";
  const targets = erased ? [] : (n.targets ?? []).filter((target, index, all) => AUDIT_TARGET_KINDS.includes(target.kind) && target.id.length > 0 && target.id.length <= 200 && all.findIndex((item) => item.kind === target.kind && item.id === target.id) === index).slice(0, SAMPLE_IDS);
  const after = targets.length ? { ...(n.after !== null && typeof n.after === "object" && !Array.isArray(n.after) ? n.after as Record<string, unknown> : n.after === undefined ? {} : { detail: n.after }), targets } : n.after;
  const base: Omit<RowRec, "hash"> = {
    seq: head.seq + 1, id: id ?? nid("aud"), at: ctx.now(), actor_kind: n.actor.kind, actor_id: n.actor.id,
    behalf_kind: n.onBehalfOf?.kind ?? null, behalf_id: n.onBehalfOf?.id ?? null, action: n.action,
    resource_type: n.resource?.type ?? null, resource_id: n.resource?.id ?? null, class: n.class,
    // an erase entry says who and when, never what
    before_json: erased ? null : jsonOf(n.before), after_json: erased ? null : jsonOf(sampled(after)), trace_id: ctx.trace.traceId, request_id: n.requestId ?? null, prev_hash: head.hash,
  };
  const row: RowRec = { ...base, hash: hashOf(base) };
  ctx.db.run(
    `INSERT INTO audit_row (seq, id, at, actor_kind, actor_id, behalf_kind, behalf_id, action, resource_type, resource_id, class, before_json, after_json, trace_id, request_id, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.seq, row.id, row.at, row.actor_kind, row.actor_id, row.behalf_kind, row.behalf_id, row.action, row.resource_type, row.resource_id, row.class,
    row.before_json, row.after_json, row.trace_id, row.request_id, row.prev_hash, row.hash);
  for (const target of targets) ctx.db.run(`INSERT INTO audit_target (kind, target_id, audit_seq) VALUES (?, ?, ?)`, target.kind, target.id, row.seq);
  return { auditId: row.id, seq: row.seq };
}

/** The class an invoke-pipeline row (allow, deny or hold) gets: a deny is a deny, a held act is sensitive, an allowed act is sensitive or a change by risk. */
export function classOfInvoke(cls: "allow" | "deny" | "hold", risk: "low" | "medium" | "high"): Klass {
  if (cls === "deny") return "deny";
  if (cls === "hold") return "sensitive";
  return risk === "low" ? "change" : "sensitive";
}

// ---- reading rows

export interface Filter {
  target?: AuditTarget | undefined;
  actor?: Ref | undefined; action?: string | undefined; resource?: ResRef | undefined; class?: Klass | undefined; from?: number | undefined; to?: number | undefined;
  q?: string | undefined; traceId?: string | undefined;
}
export function cursorOf(v: string | undefined): number | undefined {
  return v !== undefined && /^[0-9]+$/.test(v) ? Number(v) : undefined;
}
export function limitOf(v: number | undefined, dflt = PAGE_DEFAULT): number {
  return Math.min(PAGE_MAX, Math.max(1, v ?? dflt));
}

function whereOf(f: Filter, before: number | undefined): { sql: string; args: unknown[] } {
  const conds: string[] = [];
  const args: unknown[] = [];
  const eq = (col: string, v: unknown): void => { conds.push(`${col} = ?`); args.push(v); };
  if (f.actor) { eq("actor_kind", f.actor.kind); eq("actor_id", f.actor.id); }
  if (f.action) eq("action", f.action);
  if (f.resource) { eq("resource_type", f.resource.type); eq("resource_id", f.resource.id); }
  if (f.class) eq("class", f.class);
  if (f.traceId) eq("trace_id", f.traceId);
  if (f.from !== undefined) { conds.push("at >= ?"); args.push(f.from); }
  if (f.to !== undefined) { conds.push("at <= ?"); args.push(f.to); }
  if (before !== undefined) { conds.push("seq < ?"); args.push(before); }
  return { sql: conds.length ? ` WHERE ${conds.join(" AND ")}` : "", args };
}
function matchesQ(r: RowRec, q: string): boolean {
  const needle = q.toLowerCase();
  return [r.action, r.actor_id, r.behalf_id, r.resource_type, r.resource_id, r.class].some((v) => v !== null && v.toLowerCase().includes(needle));
}

/** Rows newest first, `limit` of them, and whether more follow. Filters that are plain equality run in SQL; `q` is a substring match over the readable fields. */
export function findRows(ctx: AuditCtx, f: Filter, before: number | undefined, limit: number): { rows: RowRec[]; more: boolean } {
  const out: RowRec[] = [];
  let cursor = before;
  const q = f.q?.trim();
  for (;;) {
    const w = whereOf(f, cursor);
    let chunk: RowRec[];
    let indexed: { audit_seq: number }[] | undefined;
    if (f.target) {
      indexed = (cursor === undefined
        ? ctx.db.all(`SELECT audit_seq FROM audit_target WHERE kind = ? AND target_id = ? ORDER BY audit_seq DESC LIMIT ?`, f.target.kind, f.target.id, CHUNK)
        : ctx.db.all(`SELECT audit_seq FROM audit_target WHERE kind = ? AND target_id = ? AND audit_seq < ? ORDER BY audit_seq DESC LIMIT ?`, f.target.kind, f.target.id, cursor, CHUNK)) as { audit_seq: number }[];
      if (indexed.length === 0) return { rows: out, more: false };
      const placeholders = indexed.map(() => "?").join(",");
      chunk = ctx.db.all(`SELECT * FROM audit_row${w.sql ? `${w.sql} AND` : " WHERE"} seq IN (${placeholders}) ORDER BY seq DESC LIMIT ?`, ...w.args, ...indexed.map((row) => row.audit_seq), CHUNK) as RowRec[];
    } else chunk = ctx.db.all(`SELECT * FROM audit_row${w.sql} ORDER BY seq DESC LIMIT ?`, ...w.args, CHUNK) as RowRec[];
    for (const row of chunk) {
      if (q && !matchesQ(row, q)) continue;
      if (f.target) {
        let metadata: { targets?: AuditTarget[] } = {};
        try { metadata = JSON.parse(row.after_json ?? "{}"); } catch { /* a broken metadata row never matches a target */ }
        if (!Array.isArray(metadata?.targets) || !metadata.targets.some((target) => target?.kind === f.target!.kind && target.id === f.target!.id)) continue;
      }
      if (out.length === limit) return { rows: out, more: true };
      out.push(row);
    }
    if ((indexed?.length ?? chunk.length) < CHUNK) return { rows: out, more: false };
    cursor = indexed ? indexed[indexed.length - 1]!.audit_seq : chunk[chunk.length - 1]!.seq;
  }
}

export function rowOut(r: RowRec) {
  const parse = (s: string | null): unknown => (s === null ? undefined : JSON.parse(s) as unknown);
  const before = parse(r.before_json), after = parse(r.after_json);
  return {
    id: r.id, at: r.at, actor: { kind: r.actor_kind as Ref["kind"], id: r.actor_id },
    ...(r.behalf_kind && r.behalf_id ? { onBehalfOf: { kind: r.behalf_kind as Ref["kind"], id: r.behalf_id } } : {}),
    action: r.action, ...(r.resource_type && r.resource_id ? { resource: { type: r.resource_type, id: r.resource_id } } : {}), class: r.class,
    ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}), traceId: r.trace_id,
    ...(r.request_id ? { requestId: r.request_id } : {}), seq: r.seq,
  };
}

// ---- verification

export interface Verdict { ok: boolean; checked: number; firstBadSeq?: number }

/** Does this checkpoint name the chain we hold, and (with a signer wired) is its signature the Space key's? */
export function checkpointValid(ctx: AuditCtx, cp: CheckpointRec): boolean {
  const anchor = anchorOf(ctx);
  const row = ctx.db.all(`SELECT seq, hash FROM audit_row WHERE seq = ?`, cp.seq)[0] as { seq: number; hash: string } | undefined;
  let named: boolean;
  if (cp.seq === 0) named = cp.hash === genesis(ctx.space);
  else if (row) named = row.hash === cp.hash;
  else if (anchor && anchor.seq === cp.seq) named = anchor.hash === cp.hash;
  // a checkpoint older than the archive anchor names a row that moved to the archive file; its signature is still checked below
  else named = !!anchor && cp.seq < anchor.seq;
  if (!named) return false;
  return !ctx.signer || verifyCheckpoint({ space: ctx.space, seq: cp.seq, hash: cp.hash, time: cp.at, key_id: cp.key_id, signature: cp.sig }, ctx.signer.publicKey);
}

/** Recompute the chain over [from, to] (at most VERIFY_MAX rows) and check every checkpoint at or after `from`. The first row that fails names the bad seq. */
export function verifyRange(ctx: AuditCtx, fromSeq: number | undefined, toSeq: number | undefined): Verdict {
  const first = ctx.db.all(`SELECT seq FROM audit_row ORDER BY seq ASC LIMIT 1`)[0] as { seq: number } | undefined;
  const from = Math.max(0, fromSeq ?? first?.seq ?? 1);
  const cap = from + VERIFY_MAX - 1;
  const to = Math.min(toSeq ?? cap, cap);
  const anchor = anchorOf(ctx);

  // what the first row in range must link to
  let prev: { seq: number; hash: string } | undefined;
  if (from <= 1) {
    prev = anchor && first && first.seq > 1 ? anchor : { seq: 0, hash: genesis(ctx.space) };
  } else {
    const before = ctx.db.all(`SELECT seq, hash FROM audit_row WHERE seq = ?`, from - 1)[0] as { seq: number; hash: string } | undefined;
    prev = before ?? (anchor && anchor.seq === from - 1 ? anchor : undefined);
  }

  let checked = 0;
  let bad: number | undefined;
  for (let cursor = from; bad === undefined && cursor <= to;) {
    const chunk = ctx.db.all(`SELECT * FROM audit_row WHERE seq >= ? AND seq <= ? ORDER BY seq ASC LIMIT ?`, cursor, to, CHUNK) as RowRec[];
    if (chunk.length === 0) break;
    for (const r of chunk) {
      checked++;
      const { hash, ...rest } = r;
      const gap = prev !== undefined && r.seq !== prev.seq + 1;
      const broken = prev !== undefined && r.prev_hash !== prev.hash;
      if (gap || broken || hashOf(rest) !== hash) { bad = r.seq; break; }
      prev = { seq: r.seq, hash };
    }
    cursor = chunk[chunk.length - 1]!.seq + 1;
  }
  // checkpoints catch what the chain cannot: a tail cut off, or a tail rewritten consistently
  for (let after = from - 1, done = false; !done;) {
    const cps = ctx.db.all(`SELECT * FROM audit_checkpoint WHERE seq > ? ORDER BY seq ASC LIMIT ?`, after, CHUNK) as CheckpointRec[];
    for (const cp of cps) {
      if ((toSeq !== undefined && cp.seq > toSeq) || (bad !== undefined && cp.seq > bad)) { done = true; break; }
      if (!checkpointValid(ctx, cp)) { bad = Math.min(bad ?? cp.seq, cp.seq); done = true; break; }
    }
    if (cps.length < CHUNK) done = true;
    else after = cps[cps.length - 1]!.seq;
  }
  return { ok: bad === undefined, checked, ...(bad !== undefined ? { firstBadSeq: bad } : {}) };
}

// ---- csv

const CELL_TRIGGERS = /^[=+\-@\t\r]/;
export function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // a cell that starts like a formula is quoted as text so a spreadsheet never runs it
  if (CELL_TRIGGERS.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function csvOf(rows: RowRec[]): string {
  const head = "at,actor,on_behalf_of,action,resource,class,trace_id,seq";
  const lines = rows.map((r) => [
    new Date(r.at).toISOString(), `${r.actor_kind}:${r.actor_id}`, r.behalf_id ? `${r.behalf_kind}:${r.behalf_id}` : "", r.action,
    r.resource_type ? `${r.resource_type}:${r.resource_id}` : "", r.class, r.trace_id, r.seq,
  ].map(cell).join(","));
  return [head, ...lines].join("\n") + "\n";
}

export { setMeta };
