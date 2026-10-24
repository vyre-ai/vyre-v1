// Audit capabilities (spec 2.25, ARCH 4.1). Reads are open to audit.read (the invoke pipeline checks it); viewing the log is itself an audit row, written here because
// list and get are low risk and the pipeline only audits medium and above. verify and export are `audit: always`, so the pipeline writes their rows.
import { checkpointBytes } from "../../../kernel/src/audit/index.ts";
import type { AuditCtx, CheckpointRec, Filter, Klass, Ref, ResRef, RowRec } from "../projections.ts";
import {
  ARCHIVE_MAX, CHECKPOINT_STALE_MS, CHUNK, EXPORT_MAX, appendRow, checkpointValid, csvOf, cursorOf, findRows, genesis, headOf, limitOf, raise, rowOut, setMeta,
  verifyRange, sampled,
} from "../projections.ts";

type Page = { cursor?: string; limit?: number };
const who = (ctx: AuditCtx): string => ctx.principal.id;

function noteView(ctx: AuditCtx, action: string, resource: ResRef | undefined, detail: unknown): void {
  appendRow(ctx, { actor: { kind: ctx.principal.kind, id: ctx.principal.id }, action, class: "sensitive", ...(resource ? { resource } : {}), after: detail });
}

export async function list(ctx: AuditCtx, input: Filter & Page) {
  const { cursor, limit, ...filter } = input;
  const size = limitOf(limit);
  const found = findRows(ctx, filter, cursorOf(cursor), size);
  // the view is recorded after the answer is read, so a page never lists its own view
  noteView(ctx, "audit.viewed", { type: "space", id: ctx.space }, { rows: found.rows.length, filters: Object.keys(filter).sort() });
  const last = found.rows[found.rows.length - 1];
  return { rows: found.rows.map(rowOut), ...(found.more && last ? { next: String(last.seq) } : {}) };
}

export async function get(ctx: AuditCtx, input: { auditId: string }) {
  const r = ctx.db.all(`SELECT * FROM audit_row WHERE id = ?`, input.auditId)[0] as RowRec | undefined;
  if (!r) raise(ctx, "validation.not_found", "no such audit row");
  noteView(ctx, "audit.viewed", { type: "audit", id: r.id }, { seq: r.seq });
  return { row: rowOut(r) };
}

export async function exportCsv(ctx: AuditCtx, input: Omit<Filter, "q" | "traceId">) {
  if (!ctx.exports) raise(ctx, "internal.not_implemented", "no file store is wired for audit exports");
  const rows: RowRec[] = [];
  let before: number | undefined;
  for (;;) {
    const page = findRows(ctx, input, before, CHUNK);
    rows.push(...page.rows);
    if (!page.more || rows.length >= EXPORT_MAX) break;
    before = page.rows[page.rows.length - 1]!.seq;
  }
  const kept = rows.slice(0, EXPORT_MAX).reverse();
  const name = `audit-${new Date(ctx.now()).toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
  const fileId = await ctx.exports.save(name, csvOf(kept));
  ctx.emit("audit.exported", fileId, { by: who(ctx), rows: kept.length, fileId });
  return { fileId, rows: kept.length };
}

export async function verify(ctx: AuditCtx, input: { fromSeq?: number; toSeq?: number }) {
  const v = verifyRange(ctx, input.fromSeq, input.toSeq);
  ctx.emit("audit.verified", who(ctx), { ok: v.ok, checked: v.checked, ...(v.firstBadSeq !== undefined ? { firstBadSeq: v.firstBadSeq } : {}), by: who(ctx) });
  return v;
}

function checkpointOut(ctx: AuditCtx, cp: CheckpointRec) {
  return { seq: cp.seq, at: cp.at, hash: cp.hash, signatureOk: checkpointValid(ctx, cp) };
}

export async function checkpointsList(ctx: AuditCtx, input: Page) {
  const size = limitOf(input.limit);
  const before = cursorOf(input.cursor);
  const rows = (before === undefined
    ? ctx.db.all(`SELECT * FROM audit_checkpoint ORDER BY seq DESC LIMIT ?`, size + 1)
    : ctx.db.all(`SELECT * FROM audit_checkpoint WHERE seq < ? ORDER BY seq DESC LIMIT ?`, before, size + 1)) as CheckpointRec[];
  const page = rows.slice(0, size);
  return { checkpoints: page.map((c) => checkpointOut(ctx, c)), ...(rows.length > size ? { next: String(page[page.length - 1]!.seq) } : {}) };
}

export async function archivesList(ctx: AuditCtx, _input: Record<string, never>) {
  const rows = ctx.db.all(`SELECT * FROM audit_archive ORDER BY year DESC`) as { year: number; file: string; row_count: number; size_bytes: number }[];
  return { archives: rows.map((r) => ({ year: r.year, file: r.file, rows: r.row_count, sizeBytes: r.size_bytes })) };
}

// ---- system halves

export async function checkpoint(ctx: AuditCtx, _input: Record<string, never>) {
  if (!ctx.signer) raise(ctx, "internal.not_implemented", "no checkpoint signing key is wired");
  const head = headOf(ctx);
  const have = ctx.db.all(`SELECT * FROM audit_checkpoint WHERE seq = ?`, head.seq)[0] as CheckpointRec | undefined;
  if (have) return { checkpoint: checkpointOut(ctx, have) };
  const at = ctx.now();
  const body = { space: ctx.space, seq: head.seq, hash: head.hash, time: at, key_id: ctx.signer.keyId };
  const sig = await ctx.signer.sign(checkpointBytes(body));
  ctx.db.run(`INSERT INTO audit_checkpoint (seq, at, hash, key_id, sig) VALUES (?, ?, ?, ?, ?)`, head.seq, at, head.hash, body.key_id, sig);
  ctx.emit("audit.checkpointed", String(head.seq), { seq: head.seq, hash: head.hash });
  return { checkpoint: checkpointOut(ctx, { seq: head.seq, at, hash: head.hash, key_id: body.key_id, sig }) };
}

export async function append(ctx: AuditCtx, input: { action: string; class: Klass; resource?: ResRef; onBehalfOf?: Ref; detail?: unknown }) {
  const action = input.action.trim();
  if (action.length === 0 || action.length > 200) raise(ctx, "validation.bad_input", "an audit action is 1 to 200 characters");
  const out = appendRow(ctx, {
    actor: { kind: ctx.principal.kind, id: ctx.principal.id }, action, class: input.class, ...(input.resource ? { resource: input.resource } : {}),
    ...(input.onBehalfOf ? { onBehalfOf: input.onBehalfOf } : {}), after: sampled(input.detail),
  });
  return { auditId: out.auditId };
}

/** Move rows older than `before` into the encrypted archive file, oldest first, and keep the chain verifiable through an anchor on the last row that moved. */
export async function archive(ctx: AuditCtx, input: { before: number }) {
  if (!ctx.archive) raise(ctx, "internal.not_implemented", "no archive store is wired");
  const old: RowRec[] = [];
  for (let after = 0; old.length < ARCHIVE_MAX;) {
    const chunk = ctx.db.all(`SELECT * FROM audit_row WHERE seq > ? ORDER BY seq ASC LIMIT ?`, after, CHUNK) as RowRec[];
    const stop = chunk.findIndex((r) => r.at >= input.before);
    old.push(...(stop < 0 ? chunk : chunk.slice(0, stop)));
    if (stop >= 0 || chunk.length < CHUNK) break;
    after = chunk[chunk.length - 1]!.seq;
  }
  if (old.length === 0) return { archived: 0 };
  const byYear = new Map<number, RowRec[]>();
  for (const r of old) {
    const y = new Date(r.at).getUTCFullYear();
    const bucket = byYear.get(y);
    if (bucket) bucket.push(r);
    else byYear.set(y, [r]);
  }
  const written: { year: number; rows: number; file: string }[] = [];
  for (const [year, rows] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    const res = await ctx.archive.write(year, rows.map((r) => JSON.stringify(r)));
    const have = ctx.db.all(`SELECT year, row_count, size_bytes FROM audit_archive WHERE year = ?`, year)[0] as { year: number; row_count: number; size_bytes: number } | undefined;
    if (have) ctx.db.run(`UPDATE audit_archive SET file = ?, row_count = ?, size_bytes = ? WHERE year = ?`, res.file, have.row_count + rows.length, res.sizeBytes, year);
    else ctx.db.run(`INSERT INTO audit_archive (year, file, row_count, size_bytes) VALUES (?, ?, ?, ?)`, year, res.file, rows.length, res.sizeBytes);
    written.push({ year, rows: rows.length, file: res.file });
  }
  // every year is written: now the anchor, then the move
  const last = old[old.length - 1]!;
  setMeta(ctx, "anchor_seq", String(last.seq));
  setMeta(ctx, "anchor_hash", last.hash);
  ctx.db.run(`DELETE FROM audit_row WHERE seq <= ?`, last.seq);
  for (const w of written) ctx.emit("audit.archived", w.file, w);
  return { archived: old.length };
}

export async function chainHealth(ctx: AuditCtx, _input: Record<string, never>): Promise<{ state: "healthy" | "degraded" | "down"; detail?: string; latencyMs: number }> {
  const t0 = performance.now();
  const ms = (): number => Math.max(0, Math.round(performance.now() - t0));
  const head = headOf(ctx);
  const cp = ctx.db.all(`SELECT * FROM audit_checkpoint ORDER BY seq DESC LIMIT 1`)[0] as CheckpointRec | undefined;
  if (!cp) {
    const empty = head.seq === 0 || head.hash === genesis(ctx.space);
    return empty
      ? { state: "healthy", detail: "The audit log is empty.", latencyMs: ms() }
      : { state: "degraded", detail: "No checkpoint has been signed yet.", latencyMs: ms() };
  }
  const tail = verifyRange(ctx, cp.seq, undefined);
  if (!checkpointValid(ctx, cp) || !tail.ok) return { state: "down", detail: "The newest checkpoint or the chain after it does not verify.", latencyMs: ms() };
  const age = ctx.now() - cp.at;
  if (age > CHECKPOINT_STALE_MS) return { state: "degraded", detail: `The newest checkpoint is ${Math.round(age / 60_000)} minutes old.`, latencyMs: ms() };
  return { state: "healthy", latencyMs: ms() };
}


