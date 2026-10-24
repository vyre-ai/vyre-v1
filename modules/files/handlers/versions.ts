// files versions: files.diff and the binary-conflict rule of files.write (spec 2.16, 4.11; ARCH 5.7, 7.5).
// Listing, naming and restoring a version live in tree.ts. This file adds the compare view and the collision rule:
// on a binary file the newest save is current and the other save stays as a labelled version (file.conflict_kept).
// Text, notes and docs keep their own rules (version_conflict here, Yjs merge in the editor). Google-native files hold
// export snapshots as ordinary blobs, so a snapshot diff reads the snapshot's own type (docx, text, pdf).
// Only the SQL shapes the tree handlers already use appear here, so the same fake database drives every files test.

import { ERROR_CODES, VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { ErrorCode, NextStep, VyreError } from "../../../packages/contracts/src/types.ts";
import { treeHandlers } from "./tree.ts";

type Row = Record<string, unknown>;

const NEXT: Record<NextStep["kind"], string> = {
  retry: "Try again", switch_model: "Switch model", use_backup_key: "Use the backup key", ask_access: "Ask for access", open_settings: "Open settings",
  reconnect: "Reconnect", edit_input: "Fix the input", wait: "Wait a moment", contact_admin: "Contact an admin", report: "Report a problem",
};

function fail(ctx: Ctx, code: ErrorCode, message?: string, details?: Record<string, unknown>): never {
  const def = ERROR_CODES.find((e) => e.code === code) ?? ERROR_CODES.find((e) => e.code === "internal.unexpected");
  if (!def) throw new Error("error catalogue is empty");
  const error: VyreError = {
    code: def.code, message: message ?? def.what, retryable: def.retryable, traceId: ctx.trace.traceId,
    next: def.next.map((kind) => ({ kind, label: NEXT[kind] })),
  };
  if (details) error.details = details;
  throw new VyreErr(error);
}

const isNull = (v: unknown): boolean => v === null || v === undefined;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);
const one = (ctx: Ctx, sql: string, ...args: unknown[]): Row | undefined => (ctx.db.all(sql, ...args) as Row[])[0];

function record(ctx: Ctx, input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) fail(ctx, "validation.bad_input", "The input is not valid.");
  return input as Record<string, unknown>;
}

function optStr(ctx: Ctx, o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string" || v.length === 0) fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

// ---- reading bytes ----

function blobBytes(ctx: Ctx, blobId: string): { bytes: Uint8Array; mime: string | undefined } {
  const row = one(ctx, "SELECT * FROM files_blob WHERE id = ?", blobId);
  if (!row) fail(ctx, "validation.not_found", "That blob is not in the store.", { blobId });
  try {
    const bytes = ctx.seal.unseal({ keyId: String(row.key_id), nonce: String(row.nonce), bytes: String(row.bytes) });
    return { bytes, mime: isNull(row.mime) || String(row.mime).length === 0 ? undefined : String(row.mime) };
  } catch {
    return fail(ctx, "internal.unexpected", "The blob failed its integrity check.", { blobId });
  }
}

// ---- docx paragraphs (a zip with word/document.xml; no dependency) ----

const u16 = (b: Uint8Array, o: number): number => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
const u32 = (b: Uint8Array, o: number): number => u16(b, o) + u16(b, o + 2) * 65536;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const w = ds.writable.getWriter();
  void w.write(data as BufferSource).catch(() => {});
  void w.close().catch(() => {});
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

async function zipEntry(zip: Uint8Array, wanted: string): Promise<Uint8Array | undefined> {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
    if (u32(zip, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return undefined;
  const count = u16(zip, eocd + 10);
  let p = u32(zip, eocd + 16);
  for (let i = 0; i < count && u32(zip, p) === 0x02014b50; i++) {
    const method = u16(zip, p + 10);
    const size = u32(zip, p + 20);
    const nameLen = u16(zip, p + 28);
    const extraLen = u16(zip, p + 30);
    const commentLen = u16(zip, p + 32);
    const local = u32(zip, p + 42);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
    if (name === wanted && u32(zip, local) === 0x04034b50) {
      const start = local + 30 + u16(zip, local + 26) + u16(zip, local + 28);
      const raw = zip.subarray(start, start + size);
      if (method === 0) return raw;
      if (method === 8) return inflateRaw(raw);
      return undefined;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return undefined;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_m, g: string) => {
    if (g.startsWith("#x")) return String.fromCodePoint(parseInt(g.slice(2), 16));
    if (g.startsWith("#")) return String.fromCodePoint(parseInt(g.slice(1), 10));
    return ENTITIES[g] ?? "";
  });
}

async function docxParagraphs(zip: Uint8Array): Promise<string[] | undefined> {
  const xml = await zipEntry(zip, "word/document.xml");
  if (!xml) return undefined;
  const text = new TextDecoder().decode(xml);
  const out: string[] = [];
  for (const para of text.split("</w:p>")) {
    let line = "";
    for (const m of para.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g)) {
      line += m[1] !== undefined ? unescapeXml(m[1]) : m[0].startsWith("<w:tab") ? "\t" : " ";
    }
    if (line.trim().length > 0) out.push(line);
  }
  return out;
}

// ---- the diff ----

type Op = { op: "ctx" | "add" | "del"; text: string; oldPos: number; newPos: number };
type Mark = { from: number; to: number };
type Line = { op: "ctx" | "add" | "del"; text: string; marks?: Mark[] };
type Hunk = { hunkId: string; oldStart: number; oldLines: number; newStart: number; newLines: number; lines: Line[] };

const CONTEXT = 3;
const DP_CAP = 6_000_000;

/** Longest common subsequence as a list of [oldIndex, newIndex] pairs, after trimming the shared head and tail. */
function lcsPairs(a: readonly string[], b: readonly string[]): [number, number][] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const pairs: [number, number][] = [];
  for (let i = 0; i < head; i++) pairs.push([i, i]);
  const n = a.length - head - tail;
  const m = b.length - head - tail;
  if (n > 0 && m > 0 && (n + 1) * (m + 1) <= DP_CAP) {
    const w = m + 1;
    const t = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        t[i * w + j] = a[head + i] === b[head + j] ? (t[(i + 1) * w + j + 1] ?? 0) + 1 : Math.max(t[(i + 1) * w + j] ?? 0, t[i * w + j + 1] ?? 0);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[head + i] === b[head + j]) { pairs.push([head + i, head + j]); i++; j++; }
      else if ((t[(i + 1) * w + j] ?? 0) >= (t[i * w + j + 1] ?? 0)) i++;
      else j++;
    }
  }
  for (let k = tail; k > 0; k--) pairs.push([a.length - k, b.length - k]);
  return pairs;
}

function lineOps(a: readonly string[], b: readonly string[]): Op[] {
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  const flush = (ai: number, bj: number): void => {
    while (i < ai) { ops.push({ op: "del", text: a[i] ?? "", oldPos: i + 1, newPos: j }); i++; }
    while (j < bj) { ops.push({ op: "add", text: b[j] ?? "", oldPos: i, newPos: j + 1 }); j++; }
  };
  for (const [ai, bj] of lcsPairs(a, b)) {
    flush(ai, bj);
    ops.push({ op: "ctx", text: a[ai] ?? "", oldPos: i + 1, newPos: j + 1 });
    i++; j++;
  }
  flush(a.length, b.length);
  return ops;
}

/** Character ranges of the words that differ between two lines. */
function wordMarks(left: string, right: string): { left: Mark[]; right: Mark[] } {
  const tok = (s: string): string[] => s.match(/\s+|[^\s]+/g) ?? [];
  const a = tok(left);
  const b = tok(right);
  const common = lcsPairs(a, b);
  const keepA = new Set(common.map((p) => p[0]));
  const keepB = new Set(common.map((p) => p[1]));
  const ranges = (toks: string[], keep: Set<number>): Mark[] => {
    const out: Mark[] = [];
    let at = 0;
    toks.forEach((t, idx) => {
      const from = at;
      at += t.length;
      if (keep.has(idx) || /^\s+$/.test(t)) return;
      const last = out[out.length - 1];
      if (last && last.to === from) last.to = at;
      else out.push({ from, to: at });
    });
    return out;
  };
  return { left: ranges(a, keepA), right: ranges(b, keepB) };
}

function addMarks(ops: Op[]): Map<Op, Mark[]> {
  const marks = new Map<Op, Mark[]>();
  for (let s = 0; s < ops.length; s++) {
    if (ops[s]?.op === "ctx") continue;
    let e = s;
    while (e < ops.length && ops[e]?.op !== "ctx") e++;
    const dels = ops.slice(s, e).filter((o) => o.op === "del");
    const adds = ops.slice(s, e).filter((o) => o.op === "add");
    for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
      const d = dels[k];
      const a = adds[k];
      if (!d || !a) continue;
      const m = wordMarks(d.text, a.text);
      if (m.left.length) marks.set(d, m.left);
      if (m.right.length) marks.set(a, m.right);
    }
    s = e;
  }
  return marks;
}

function hunksOf(ops: Op[], marks: Map<Op, Mark[]> | undefined): Hunk[] {
  const changed: number[] = [];
  ops.forEach((o, idx) => { if (o.op !== "ctx") changed.push(idx); });
  const groups: [number, number][] = [];
  for (const idx of changed) {
    const last = groups[groups.length - 1];
    if (last && idx - last[1] <= CONTEXT * 2 + 1) last[1] = idx;
    else groups.push([idx, idx]);
  }
  return groups.map(([first, last], n) => {
    const from = Math.max(0, first - CONTEXT);
    const to = Math.min(ops.length - 1, last + CONTEXT);
    const slice = ops.slice(from, to + 1);
    const oldLines = slice.filter((o) => o.op !== "add").length;
    const newLines = slice.filter((o) => o.op !== "del").length;
    const head = slice[0];
    return {
      hunkId: `h${n + 1}`,
      oldStart: head ? head.oldPos : 0,
      oldLines,
      newStart: head ? head.newPos : 0,
      newLines,
      lines: slice.map((o): Line => {
        const m = marks?.get(o);
        return m ? { op: o.op, text: o.text, marks: m } : { op: o.op, text: o.text };
      }),
    };
  });
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function splitParagraphs(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0);
}

export interface DiffOut {
  kind: "text" | "paragraph" | "image" | "binary";
  added: number;
  removed: number;
  hunks: Hunk[];
  images?: { left?: string; right?: string };
  identical: boolean;
}

const TEXT_MAX = 2 * 1024 * 1024;
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

type Side = { blobId: string; hash: string; mime: string } | undefined;
type Shape = "image" | "docx" | "markdown" | "text" | "binary";

function shapeOf(file: Row, mime: string): Shape {
  const kind = String(file.kind);
  const ext = extOf(String(file.name));
  if (mime.startsWith("image/") && mime !== "image/svg+xml") return "image";
  if (mime === DOCX || ext === "docx") return "docx";
  if (kind === "markdown" || mime === "text/markdown" || ext === "md") return "markdown";
  if (mime.startsWith("text/") || mime === "application/json" || mime === "image/svg+xml" || kind === "text" || kind === "code") return "text";
  return "binary";
}

function sideOf(ctx: Ctx, file: Row, version: Row | undefined): Side {
  if (!version) return undefined;
  const blob = one(ctx, "SELECT * FROM files_blob WHERE id = ?", String(version.blob));
  if (!blob) fail(ctx, "validation.not_found", "That blob is not in the store.", { blobId: String(version.blob) });
  const mime = !isNull(blob.mime) && String(blob.mime).length > 0 ? String(blob.mime) : String(file.mime);
  return { blobId: String(blob.id), hash: String(blob.hash), mime };
}

async function sideLines(ctx: Ctx, side: Side, shape: Shape, paragraphs: boolean): Promise<string[] | undefined> {
  if (!side) return [];
  const { bytes } = blobBytes(ctx, side.blobId);
  if (shape === "docx") return docxParagraphs(bytes);
  if (bytes.byteLength > TEXT_MAX) return undefined;
  const text = new TextDecoder().decode(bytes);
  return paragraphs ? splitParagraphs(text) : splitLines(text);
}

async function filesDiff(ctx: Ctx, input: unknown): Promise<DiffOut> {
  const o = record(ctx, input);
  const fileId = optStr(ctx, o, "fileId");
  if (!fileId) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "fileId" });
  const file = one(ctx, "SELECT * FROM files_file WHERE id = ?", fileId);
  if (!file) return fail(ctx, "validation.not_found", "That file does not exist.", { fileId });
  const mode = optStr(ctx, o, "mode");
  if (mode !== undefined && !["unified", "split", "words", "paragraph"].includes(mode)) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "mode" });

  const versions = (ctx.db.all("SELECT * FROM files_file_version WHERE file_id = ?", fileId) as Row[]).sort((a, b) => num(b.n) - num(a.n));
  const byId = (id: string): Row => {
    const v = versions.find((x) => String(x.id) === id);
    if (!v) return fail(ctx, "validation.not_found", "That version is not on this file.", { versionId: id });
    return v;
  };
  const toId = optStr(ctx, o, "to");
  const fromId = optStr(ctx, o, "from");
  const to = toId ? byId(toId) : versions[0];
  const from = fromId ? byId(fromId) : to ? versions.find((v) => num(v.n) < num(to.n)) : undefined;

  const right = sideOf(ctx, file, to);
  const left = sideOf(ctx, file, from);
  const identical = left !== undefined && right !== undefined && left.hash === right.hash;
  const shape = shapeOf(file, (right ?? left)?.mime ?? String(file.mime));

  const plain = (kind: "image" | "binary"): DiffOut => {
    const out: DiffOut = { kind, added: 0, removed: 0, hunks: [], identical };
    if (kind === "image") {
      const images: { left?: string; right?: string } = {};
      if (left) images.left = left.blobId;
      if (right) images.right = right.blobId;
      out.images = images;
    }
    return out;
  };
  if (shape === "image") return plain("image");
  if (shape === "binary") return plain("binary");

  const paragraphs = shape === "docx" || mode === "paragraph" || (mode === undefined && shape === "markdown");
  const a = await sideLines(ctx, left, shape, paragraphs);
  const b = await sideLines(ctx, right, shape, paragraphs);
  if (a === undefined || b === undefined) return plain("binary");
  const ops = lineOps(a, b);
  const marks = mode === "words" || paragraphs ? addMarks(ops) : undefined;
  return {
    kind: paragraphs ? "paragraph" : "text",
    added: ops.filter((x) => x.op === "add").length,
    removed: ops.filter((x) => x.op === "del").length,
    hunks: hunksOf(ops, marks),
    identical,
  };
}

// ---- binary conflicts ----

function isBinaryFile(file: Row): boolean {
  const kind = String(file.kind);
  const mime = String(file.mime);
  if (["text", "markdown", "code", "google_native"].includes(kind)) return false;
  if (mime.startsWith("text/") || mime === "application/json") return false;
  return true;
}

type WriteResult = Awaited<ReturnType<(typeof treeHandlers)["files.write"]>>;

/**
 * files.write with the binary collision rule. A save that names an older baseVersion on a binary file is not refused:
 * it becomes current, and the version it overtook stays in History with a label and a file.conflict_kept event
 * (the Conflicts list reads that event). Everything else goes straight to the tree handler.
 */
async function filesWrite(ctx: Ctx, input: unknown): Promise<WriteResult> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return treeHandlers["files.write"](ctx, input);
  const o = input as Record<string, unknown>;
  const fileId = typeof o.fileId === "string" ? o.fileId : undefined;
  const base = typeof o.baseVersion === "number" ? o.baseVersion : undefined;
  const file = fileId ? one(ctx, "SELECT * FROM files_file WHERE id = ?", fileId) : undefined;
  if (!file || !isNull(file.deleted_at) || base === undefined || base === num(file.version) || !isBinaryFile(file)) {
    return treeHandlers["files.write"](ctx, input);
  }
  const overtaken = (ctx.db.all("SELECT * FROM files_file_version WHERE file_id = ?", String(file.id)) as Row[]).find((v) => num(v.n) === num(file.version));
  const rest: Record<string, unknown> = { ...o };
  delete rest.baseVersion;
  const result = await treeHandlers["files.write"](ctx, rest);
  if (!overtaken || result.versionId === undefined) return result;
  const by = String(overtaken.actor);
  ctx.db.run(
    "UPDATE files_file_version SET name = ?, reason = ?, updated_at = ? WHERE id = ?",
    isNull(overtaken.name) || String(overtaken.name).length === 0 ? `Conflict: kept (saved by ${by})` : String(overtaken.name),
    "conflict", ctx.now(), String(overtaken.id),
  );
  ctx.emit("file.conflict_kept", `file/${String(file.id)}`, {
    fileId: String(file.id), keptVersionId: String(overtaken.id), currentVersionId: result.versionId,
  });
  ctx.log.info("files.conflict_kept", { fileId: String(file.id), kept: num(overtaken.n), current: num(file.version) + 1 });
  return result;
}

export const versionHandlers = {
  "files.diff": (ctx: Ctx, input: unknown) => filesDiff(ctx, input),
  "files.write": (ctx: Ctx, input: unknown) => filesWrite(ctx, input),
};
