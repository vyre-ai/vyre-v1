// Previews (spec 2.16 Viewer and markup, 3.5; ARCH 7.5, golden 6): thumbnails, page images and extracted text for a file version, cached by (file, version).
//
//   image    PNG is decoded and scaled here (area average, no upscaling); JPEG, WebP, GIF and the rest go through vipsthumbnail. Sizes s, m, l, xl are 96, 256, 640 and 1280 pixels wide.
//   pdf      text from pdftotext when it is on the server, else the text layer read straight from the file (Flate streams, simple fonts); page count from the page tree; page images from pdftoppm.
//   office   docx, pptx, xlsx and the OpenDocument formats are read as zip files here, so their text and slide or sheet counts need no converter; page images, and the legacy formats (doc, xls, ppt, rtf),
//            go through soffice (to PDF) then pdftoppm.
//   text     plain, markdown, code, csv, json and the like are the text.
//   other    video, audio, archives: failed with reason `unsupported`; the file still opens as a download.
// No OCR in v1: a scan with no text layer returns empty text with source `none`.
//
// Bytes come from the files module (files.read as base64, in chunks; the made images are kept as blobs (handlers/store.ts), only the extracted text is copied into this module's tables).
// A preview never blocks a save: the consumer of file.version_added only queues the version; previews.render (or the first read of a preview) makes it.
// The converters run as child processes through an injected Exec (argv, no shell, a deadline), so tests drive a fake and the host passes processExec(). A missing converter is reason `converter_down` for the
// part that needs it; everything that does not need it keeps working, and previews.health says what is missing.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateSync, inflateRawSync, inflateSync } from "node:zlib";
import { ERROR_CODES, VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { ErrorCode, NextStep, VyreError } from "../../../packages/contracts/src/types.ts";
import type { StoredImage } from "./store.ts";
import { blobRef, dropImages, findImage, putImage, sweepGc } from "./store.ts";

type Row = Record<string, unknown>;

// ---- drivers ------------------------------------------------------------------------------------------------

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Exec = (argv: string[], opts?: ExecOptions) => Promise<ExecResult>;

export interface PreviewDrivers {
  exec: Exec;
  /** where converter scratch directories are made (default: the OS temp directory) */
  tmpDir?: string;
  /** converter program names or paths */
  tools?: { pdftoppm?: string; pdftotext?: string; soffice?: string; vips?: string };
}

let configured: PreviewDrivers | null = null;

/** The host (or a test) calls this with its drivers. Null clears; without drivers the converters run through the process. */
export function configurePreviews(d: PreviewDrivers | null): void {
  configured = d;
}

function drivers(): PreviewDrivers {
  return configured ?? { exec: processExec() };
}

/** Runs a command without a shell. A timeout kills the process and returns code 124; a program that is not there returns 127. */
export function processExec(): Exec {
  return (argv, opts = {}) =>
    new Promise<ExecResult>((resolve) => {
      const [cmd, ...rest] = argv;
      if (cmd === undefined) {
        resolve({ code: 127, stdout: "", stderr: "no command" });
        return;
      }
      const child = spawn(cmd, rest, { cwd: opts.cwd, env: { ...process.env, ...(opts.env ?? {}) }, stdio: ["ignore", "pipe", "pipe"] });
      const out: Buffer[] = [];
      let stderr = "";
      let timedOut = false;
      const timer = opts.timeoutMs === undefined ? null : setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, opts.timeoutMs);
      child.stdout.on("data", (d: Buffer) => { out.push(d); });
      child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
      child.on("error", (e) => {
        if (timer) clearTimeout(timer);
        resolve({ code: 127, stdout: "", stderr: stderr + e.message });
      });
      child.on("close", (code) => {
        if (timer) clearTimeout(timer);
        resolve({ code: timedOut ? 124 : (code ?? 1), stdout: Buffer.concat(out).toString("utf8"), stderr: timedOut ? `${stderr}\ntimed out after ${opts.timeoutMs} ms` : stderr });
      });
    });
}

const tool = (d: PreviewDrivers, name: "pdftoppm" | "pdftotext" | "soffice" | "vips"): string => d.tools?.[name] ?? (name === "vips" ? "vipsthumbnail" : name);

// ---- errors and helpers -------------------------------------------------------------------------------------

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

function fail(ctx: Ctx, code: ErrorCode, message?: string, details?: Record<string, unknown>): never {
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

function record(ctx: Ctx, input: unknown): Row {
  if (input === null || typeof input !== "object" || Array.isArray(input)) fail(ctx, "validation.bad_input", "The input is not valid.");
  return input as Row;
}

const obj = (v: unknown): Row => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const isNull = (v: unknown): boolean => v === null || v === undefined;

function reqStr(ctx: Ctx, o: Row, key: string): string {
  const v = o[key];
  if (typeof v !== "string" || v.length === 0) fail(ctx, "validation.bad_input", `${key} is required.`);
  return v;
}

function optStr(o: Row, key: string): string | undefined {
  const v = o[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function optInt(ctx: Ctx, o: Row, key: string, min: number, max: number): number | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) fail(ctx, "validation.bad_input", `${key} must be a whole number from ${min} to ${max}.`);
  return v;
}

const locks = new Map<string, Promise<unknown>>();

async function exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.catch(() => undefined);
  locks.set(key, tail);
  try {
    return await next;
  } finally {
    if (locks.get(key) === tail) locks.delete(key);
  }
}

// ---- sizes and limits ---------------------------------------------------------------------------------------

export type SizeKey = "s" | "m" | "l" | "xl";
export const SIZE_WIDTH: Record<SizeKey, number> = { s: 96, m: 256, l: 640, xl: 1280 };
const SIZES: readonly SizeKey[] = ["s", "m", "l", "xl"];
/** Largest file read for a preview. */
export const MAX_BYTES = 30 * 1024 * 1024;
/** Largest picture decoded here, in pixels. */
export const MAX_PIXELS = 60_000_000;
/** Longest text kept, in characters. */
export const MAX_TEXT = 1_000_000;
const CHUNK = 1024 * 1024;
const TOOL_MS = 60_000;
/** Pages made in one previews.pages call. */
export const MAX_PAGES_PER_CALL = 50;

const sizeOf = (ctx: Ctx, v: string | undefined): SizeKey => {
  if (v === undefined) return "m";
  if (v !== "s" && v !== "m" && v !== "l" && v !== "xl") return fail(ctx, "validation.bad_input", "size must be s, m, l or xl.");
  return v;
};

// ---- bytes --------------------------------------------------------------------------------------------------

const u16be = (b: Uint8Array, i: number): number => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const u32be = (b: Uint8Array, i: number): number => (((b[i] ?? 0) * 2 ** 24) + (((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0))) >>> 0;
const u16le = (b: Uint8Array, i: number): number => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
const u32le = (b: Uint8Array, i: number): number => ((b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16) | ((b[i + 3] ?? 0) << 24)) >>> 0;
const ascii = (b: Uint8Array, i: number, n: number): string => String.fromCharCode(...Array.from(b.subarray(i, i + n)));
const latin1 = (b: Uint8Array): string => Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("latin1");

let crcTable: Uint32Array | null = null;

function crc32(b: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = (crcTable[(c ^ (b[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---- pictures: probing, PNG decode, scaling, PNG encode -----------------------------------------------------

export interface Dim { width: number; height: number; mime: string }

/** Size and type of a picture from its header. Null when the bytes are not a picture this reads. */
export function probeImage(b: Uint8Array): Dim | null {
  if (b.length >= 24 && ascii(b, 1, 3) === "PNG" && b[0] === 137) return { width: u32be(b, 16), height: u32be(b, 20), mime: "image/png" };
  if (b.length >= 10 && ascii(b, 0, 4) === "GIF8") return { width: u16le(b, 6), height: u16le(b, 8), mime: "image/gif" };
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i += 1; continue; }
      const marker = b[i + 1] ?? 0;
      if (marker === 0xff) { i += 1; continue; }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: u16be(b, i + 7), height: u16be(b, i + 5), mime: "image/jpeg" };
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
      i += 2 + u16be(b, i + 2);
    }
    return null;
  }
  if (b.length >= 30 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
    const kind = ascii(b, 12, 4);
    if (kind === "VP8 ") return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff, mime: "image/webp" };
    if (kind === "VP8L") return { width: 1 + ((b[21] ?? 0) | (((b[22] ?? 0) & 0x3f) << 8)), height: 1 + (((b[22] ?? 0) >> 6) | ((b[23] ?? 0) << 2) | (((b[24] ?? 0) & 0xf) << 10)), mime: "image/webp" };
    if (kind === "VP8X") return { width: 1 + ((b[24] ?? 0) | ((b[25] ?? 0) << 8) | ((b[26] ?? 0) << 16)), height: 1 + ((b[27] ?? 0) | ((b[28] ?? 0) << 8) | ((b[29] ?? 0) << 16)), mime: "image/webp" };
    return null;
  }
  if (b.length >= 26 && b[0] === 0x42 && b[1] === 0x4d) return { width: u32le(b, 18), height: Math.abs(u32le(b, 22) | 0), mime: "image/bmp" };
  return null;
}

export interface Raster { width: number; height: number; /** RGBA, 8 bits */ data: Uint8Array }

/** A non-interlaced PNG as RGBA, or null (interlaced, too large, damaged). */
export function decodePng(b: Uint8Array): Raster | null {
  if (!(b.length > 33 && b[0] === 137 && ascii(b, 1, 3) === "PNG")) return null;
  let pos = 8;
  let w = 0;
  let h = 0;
  let depth = 0;
  let ct = -1;
  let interlace = 1;
  let plte: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (pos + 12 <= b.length) {
    const len = u32be(b, pos);
    const type = ascii(b, pos + 4, 4);
    const data = b.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") {
      w = u32be(data, 0);
      h = u32be(data, 4);
      depth = data[8] ?? 0;
      ct = data[9] ?? -1;
      interlace = data[12] ?? 1;
    } else if (type === "PLTE") plte = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  if (w < 1 || h < 1 || interlace !== 0 || w * h > MAX_PIXELS) return null;
  const channels = ct === 0 ? 1 : ct === 2 ? 3 : ct === 3 ? 1 : ct === 4 ? 2 : ct === 6 ? 4 : 0;
  if (channels === 0 || ![1, 2, 4, 8, 16].includes(depth) || (ct === 3 && (!plte || depth > 8)) || ((ct === 2 || ct === 4 || ct === 6) && depth < 8)) return null;
  const bitsPerPixel = channels * depth;
  const rowBytes = Math.ceil((w * bitsPerPixel) / 8);
  const step = Math.max(1, bitsPerPixel >> 3);
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat), { maxOutputLength: h * (rowBytes + 1) + 16 });
  } catch {
    return null;
  }
  if (raw.length < h * (rowBytes + 1)) return null;
  const px = new Uint8Array(h * rowBytes);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (rowBytes + 1)] ?? 0;
    const src = y * (rowBytes + 1) + 1;
    const dst = y * rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const cur = raw[src + x] ?? 0;
      const left = x >= step ? px[dst + x - step] ?? 0 : 0;
      const up = y > 0 ? px[dst - rowBytes + x] ?? 0 : 0;
      const upLeft = y > 0 && x >= step ? px[dst - rowBytes + x - step] ?? 0 : 0;
      let v: number;
      if (ft === 0) v = cur;
      else if (ft === 1) v = cur + left;
      else if (ft === 2) v = cur + up;
      else if (ft === 3) v = cur + ((left + up) >> 1);
      else if (ft === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        v = cur + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      } else return null;
      px[dst + x] = v & 0xff;
    }
  }
  const out = new Uint8Array(w * h * 4);
  const sample = (row: number, index: number): number => {
    // the index-th sample of a row, scaled to 8 bits for gray, raw for palette
    const base = row * rowBytes;
    if (depth === 8) return px[base + index] ?? 0;
    if (depth === 16) return px[base + index * 2] ?? 0;
    const perByte = 8 / depth;
    const byte = px[base + Math.floor(index / perByte)] ?? 0;
    const shift = 8 - depth * ((index % perByte) + 1);
    const v = (byte >> shift) & ((1 << depth) - 1);
    return ct === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1));
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (ct === 0) {
        const g = sample(y, x);
        out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = 255;
      } else if (ct === 2) {
        out[o] = sample(y, x * 3); out[o + 1] = sample(y, x * 3 + 1); out[o + 2] = sample(y, x * 3 + 2); out[o + 3] = 255;
      } else if (ct === 3) {
        const i = sample(y, x);
        out[o] = plte?.[i * 3] ?? 0; out[o + 1] = plte?.[i * 3 + 1] ?? 0; out[o + 2] = plte?.[i * 3 + 2] ?? 0; out[o + 3] = trns?.[i] ?? 255;
      } else if (ct === 4) {
        const g = sample(y, x * 2);
        out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = sample(y, x * 2 + 1);
      } else {
        out[o] = sample(y, x * 4); out[o + 1] = sample(y, x * 4 + 1); out[o + 2] = sample(y, x * 4 + 2); out[o + 3] = sample(y, x * 4 + 3);
      }
    }
  }
  return { width: w, height: h, data: out };
}

/** Area-average scaling to the given width (height keeps the aspect ratio, at least 1). */
export function scaleRaster(r: Raster, targetWidth: number): Raster {
  const tw = Math.max(1, Math.min(targetWidth, r.width));
  const th = Math.max(1, Math.round((r.height * tw) / r.width));
  if (tw === r.width && th === r.height) return r;
  const out = new Uint8Array(tw * th * 4);
  for (let dy = 0; dy < th; dy++) {
    const y0 = Math.floor((dy * r.height) / th);
    const y1 = Math.max(y0 + 1, Math.floor(((dy + 1) * r.height) / th));
    for (let dx = 0; dx < tw; dx++) {
      const x0 = Math.floor((dx * r.width) / tw);
      const x1 = Math.max(x0 + 1, Math.floor(((dx + 1) * r.width) / tw));
      let sr = 0; let sg = 0; let sb = 0; let sa = 0; let n = 0;
      for (let y = y0; y < y1 && y < r.height; y++) {
        for (let x = x0; x < x1 && x < r.width; x++) {
          const i = (y * r.width + x) * 4;
          const a = r.data[i + 3] ?? 0;
          sr += (r.data[i] ?? 0) * a; sg += (r.data[i + 1] ?? 0) * a; sb += (r.data[i + 2] ?? 0) * a; sa += a; n += 1;
        }
      }
      const o = (dy * tw + dx) * 4;
      if (sa > 0) {
        out[o] = Math.round(sr / sa); out[o + 1] = Math.round(sg / sa); out[o + 2] = Math.round(sb / sa);
      }
      out[o + 3] = n > 0 ? Math.round(sa / n) : 0;
    }
  }
  return { width: tw, height: th, data: out };
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** An 8-bit PNG: RGB when nothing is transparent, else RGBA. */
export function encodePng(r: Raster): Uint8Array {
  let opaque = true;
  for (let i = 3; i < r.data.length; i += 4) if (r.data[i] !== 255) { opaque = false; break; }
  const channels = opaque ? 3 : 4;
  const rowBytes = r.width * channels;
  const raw = new Uint8Array(r.height * (rowBytes + 1));
  for (let y = 0; y < r.height; y++) {
    const o = y * (rowBytes + 1);
    raw[o] = 0;
    for (let x = 0; x < r.width; x++) {
      const s = (y * r.width + x) * 4;
      const d = o + 1 + x * channels;
      raw[d] = r.data[s] ?? 0; raw[d + 1] = r.data[s + 1] ?? 0; raw[d + 2] = r.data[s + 2] ?? 0;
      if (!opaque) raw[d + 3] = r.data[s + 3] ?? 0;
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, r.width);
  dv.setUint32(4, r.height);
  ihdr[8] = 8;
  ihdr[9] = opaque ? 2 : 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// ---- zip (office files) -------------------------------------------------------------------------------------

export type ZipEntries = Map<string, () => Uint8Array>;

/** The entries of a zip file, each inflated only when asked for. Null when it is not a zip file. */
export function readZip(b: Uint8Array): ZipEntries | null {
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (u32le(b, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = u16le(b, eocd + 10);
  let at = u32le(b, eocd + 16);
  const out: ZipEntries = new Map();
  for (let n = 0; n < count && at + 46 <= b.length; n++) {
    if (u32le(b, at) !== 0x02014b50) return null;
    const method = u16le(b, at + 10);
    const comp = u32le(b, at + 20);
    const nameLen = u16le(b, at + 28);
    const extraLen = u16le(b, at + 30);
    const commentLen = u16le(b, at + 32);
    const local = u32le(b, at + 42);
    const name = Buffer.from(b.subarray(at + 46, at + 46 + nameLen)).toString("utf8");
    at += 46 + nameLen + extraLen + commentLen;
    if (u32le(b, local) !== 0x04034b50) continue;
    const start = local + 30 + u16le(b, local + 26) + u16le(b, local + 28);
    const raw = b.subarray(start, start + comp);
    if (method === 0) out.set(name, () => raw);
    else if (method === 8) out.set(name, () => new Uint8Array(inflateRawSync(raw, { maxOutputLength: 100 * 1024 * 1024 })));
  }
  return out;
}

const entryText = (z: ZipEntries, name: string): string | undefined => {
  const f = z.get(name);
  if (!f) return undefined;
  try {
    return Buffer.from(f()).toString("utf8");
  } catch {
    return undefined;
  }
};

// ---- office text --------------------------------------------------------------------------------------------

function unxml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number.parseInt(d, 10)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

export interface Extracted { text: string; pages?: number }

function docxText(z: ZipEntries): Extracted | null {
  const xml = entryText(z, "word/document.xml");
  if (xml === undefined) return null;
  let out = "";
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:(?:br|cr)(?:\s[^>]*)?\/>|<\/w:p>|<\/w:tc>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const tag = m[0];
    if (tag.startsWith("<w:t>") || tag.startsWith("<w:t ")) out += unxml(m[1] ?? "");
    else if (tag === "<w:tab/>" || tag === "</w:tc>") out += "\t";
    else out += "\n";
  }
  return { text: out.replace(/\t+\n/g, "\n").trimEnd() };
}

function pptxText(z: ZipEntries): Extracted | null {
  const slides = [...z.keys()].map((k) => /^ppt\/slides\/slide(\d+)\.xml$/.exec(k)).filter((m): m is RegExpExecArray => m !== null).sort((a, b) => Number(a[1]) - Number(b[1]));
  if (slides.length === 0) return null;
  const texts = slides.map((m) => {
    const xml = entryText(z, m[0]) ?? "";
    let out = "";
    const re = /<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>|<\/a:p>/g;
    for (let t = re.exec(xml); t; t = re.exec(xml)) out += t[0] === "</a:p>" ? "\n" : unxml(t[1] ?? "");
    return out.trimEnd();
  });
  return { text: texts.join("\f"), pages: slides.length };
}

const colIndex = (ref: string): number => {
  let n = 0;
  for (const ch of ref.replace(/[^A-Za-z]/g, "").toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

function xlsxText(z: ZipEntries): Extracted | null {
  const shared: string[] = [];
  const sst = entryText(z, "xl/sharedStrings.xml");
  if (sst !== undefined) {
    for (const si of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      let s = "";
      for (const t of (si[1] ?? "").matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)) s += unxml(t[1] ?? "");
      shared.push(s);
    }
  }
  const book = entryText(z, "xl/workbook.xml");
  const rels = entryText(z, "xl/_rels/workbook.xml.rels");
  const sheets: { name: string; file: string }[] = [];
  if (book !== undefined) {
    const targets = new Map<string, string>();
    for (const r of (rels ?? "").matchAll(/<Relationship\s[^>]*>/g)) {
      const id = /\bId="([^"]*)"/.exec(r[0])?.[1];
      const target = /\bTarget="([^"]*)"/.exec(r[0])?.[1];
      if (id !== undefined && target !== undefined) targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
    }
    for (const s of book.matchAll(/<sheet\s[^>]*>/g)) {
      const name = /\bname="([^"]*)"/.exec(s[0])?.[1];
      const rid = /\br:id="([^"]*)"/.exec(s[0])?.[1];
      const file = rid !== undefined ? targets.get(rid) : undefined;
      if (name !== undefined && file !== undefined) sheets.push({ name: unxml(name), file });
    }
  }
  if (sheets.length === 0) {
    const files = [...z.keys()].map((k) => /^xl\/worksheets\/sheet(\d+)\.xml$/.exec(k)).filter((m): m is RegExpExecArray => m !== null).sort((a, b) => Number(a[1]) - Number(b[1]));
    for (const m of files) sheets.push({ name: `Sheet${m[1]}`, file: m[0] });
  }
  if (sheets.length === 0) return null;
  const texts = sheets.map((sh) => {
    const xml = entryText(z, sh.file) ?? "";
    const lines: string[] = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of (row[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1] ?? "";
        const inner = c[2] ?? "";
        const at = colIndex(/\br="([^"]*)"/.exec(attrs)?.[1] ?? "");
        const type = /\bt="([^"]*)"/.exec(attrs)?.[1] ?? "n";
        let value = "";
        if (type === "inlineStr") for (const t of inner.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)) value += unxml(t[1] ?? "");
        else {
          const v = /<v>([^<]*)<\/v>/.exec(inner)?.[1] ?? "";
          value = type === "s" ? shared[Number(v)] ?? "" : type === "b" ? (v === "1" ? "TRUE" : "FALSE") : unxml(v);
        }
        if (at >= 0) { while (cells.length < at) cells.push(""); cells[at] = value; } else cells.push(value);
      }
      lines.push(cells.join("\t").replace(/\t+$/, ""));
    }
    return `# ${sh.name}\n${lines.join("\n")}`.trimEnd();
  });
  return { text: texts.join("\f"), pages: sheets.length };
}

function odfText(z: ZipEntries): Extracted | null {
  const xml = entryText(z, "content.xml");
  if (xml === undefined) return null;
  const body = /<office:body>([\s\S]*)<\/office:body>/.exec(xml)?.[1] ?? xml;
  const text = body
    .replace(/<text:tab\/>/g, "\t").replace(/<text:s(?:\s[^>]*)?\/>/g, " ").replace(/<text:line-break\/>/g, "\n")
    .replace(/<\/(?:text:p|text:h|table:table-row)>/g, "\n").replace(/<\/table:table-cell>/g, "\t")
    .replace(/<[^>]*>/g, "");
  return { text: unxml(text).replace(/\t+\n/g, "\n").trimEnd() };
}

// ---- pdf (pure reader: page count and the text layer of simple files) --------------------------------------

interface PdfObj { dict: string; stream?: Uint8Array }

function pdfObjects(b: Uint8Array): Map<number, PdfObj> {
  const s = latin1(b);
  const objs = new Map<number, PdfObj>();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const start = m.index + m[0].length;
    const end = s.indexOf("endobj", start);
    const body = s.slice(start, end < 0 ? s.length : end);
    const sIdx = body.search(/\bstream\r?\n/);
    if (sIdx < 0) { objs.set(Number(m[1]), { dict: body }); continue; }
    const dict = body.slice(0, sIdx);
    const dataStart = start + sIdx + (/\bstream\r\n/.test(body.slice(sIdx, sIdx + 9)) ? 8 : 7);
    const dataEnd = s.indexOf("endstream", dataStart);
    let dataStop = dataEnd < 0 ? start + body.length : dataEnd;
    // the end-of-line before "endstream" belongs to the syntax, not to the data
    if (b[dataStop - 1] === 0x0a) dataStop -= b[dataStop - 2] === 0x0d ? 2 : 1;
    else if (b[dataStop - 1] === 0x0d) dataStop -= 1;
    let data = b.subarray(dataStart, Math.max(dataStart, dataStop));
    if (/\/FlateDecode/.test(dict)) {
      try {
        data = new Uint8Array(inflateSync(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { maxOutputLength: 50 * 1024 * 1024 }));
      } catch {
        continue;
      }
    } else if (/\/Filter/.test(dict)) continue;
    objs.set(Number(m[1]), { dict, stream: data });
    re.lastIndex = Math.max(re.lastIndex, dataEnd < 0 ? re.lastIndex : dataEnd);
  }
  return objs;
}

const isPage = (dict: string): boolean => /\/Type\s*\/Page(?![A-Za-z])/.test(dict);

/** Pages of a PDF: page objects found in the file, else the largest /Count of a page tree. */
export function pdfPageCount(b: Uint8Array): number {
  const s = latin1(b);
  const pages = (s.match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
  let counted = 0;
  for (const m of s.matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)/g)) counted = Math.max(counted, Number(m[1]));
  for (const m of s.matchAll(/\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/g)) counted = Math.max(counted, Number(m[1]));
  return Math.max(pages, counted);
}

function pdfString(raw: string): string {
  return raw.replace(/\\(\r\n|\n|\r)/g, "").replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_m, c: string) => {
    if (c === "n") return "\n";
    if (c === "r") return "\r";
    if (c === "t") return "\t";
    if (c === "b") return "\b";
    if (c === "f") return "\f";
    if (/^[0-7]+$/.test(c)) return String.fromCharCode(Number.parseInt(c, 8) & 0xff);
    return c;
  });
}

/** Text shown by one page content stream, in drawing order, with a line break where the text position moves down. */
function contentText(content: string): string {
  let out = "";
  let lastY: number | null = null;
  const nl = (): void => { if (out !== "" && !out.endsWith("\n")) out += "\n"; };
  const stack: (string | number | (string | number)[])[] = [];
  let i = 0;
  const n = content.length;
  const readString = (): string => {
    let depth = 1;
    let s = "";
    i += 1;
    while (i < n && depth > 0) {
      const c = content[i] ?? "";
      if (c === "\\") { s += c + (content[i + 1] ?? ""); i += 2; continue; }
      if (c === "(") depth += 1;
      if (c === ")") { depth -= 1; if (depth === 0) break; }
      s += c;
      i += 1;
    }
    i += 1;
    return pdfString(s);
  };
  const showArgs = (v: unknown): string => {
    if (typeof v === "string") return v;
    if (Array.isArray(v)) {
      let s = "";
      for (const part of v) {
        if (typeof part === "string") s += part;
        else if (typeof part === "number" && part < -200) s += " ";
      }
      return s;
    }
    return "";
  };
  while (i < n) {
    const c = content[i] ?? "";
    if (c === "(") { stack.push(readString()); continue; }
    if (c === "[") {
      i += 1;
      const arr: (string | number)[] = [];
      while (i < n && content[i] !== "]") {
        const d = content[i] ?? "";
        if (d === "(") arr.push(readString());
        else if (/[-+.\d]/.test(d)) {
          const m = /^[-+]?\d*\.?\d+/.exec(content.slice(i, i + 24));
          if (m) { arr.push(Number(m[0])); i += m[0].length; } else i += 1;
        } else if (d === "<" && content[i + 1] !== "<") {
          const end = content.indexOf(">", i);
          const hex = content.slice(i + 1, end < 0 ? n : end).replace(/\s/g, "");
          let s = "";
          for (let k = 0; k + 1 < hex.length; k += 2) s += String.fromCharCode(Number.parseInt(hex.slice(k, k + 2), 16));
          arr.push(s);
          i = end < 0 ? n : end + 1;
        } else i += 1;
      }
      i += 1;
      stack.push(arr);
      continue;
    }
    if (c === "<" && content[i + 1] !== "<") {
      const end = content.indexOf(">", i);
      const hex = content.slice(i + 1, end < 0 ? n : end).replace(/\s/g, "");
      let s = "";
      for (let k = 0; k + 1 < hex.length; k += 2) s += String.fromCharCode(Number.parseInt(hex.slice(k, k + 2), 16));
      stack.push(s);
      i = end < 0 ? n : end + 1;
      continue;
    }
    if (c === "%") { while (i < n && content[i] !== "\n" && content[i] !== "\r") i += 1; continue; }
    if (c === "/" || /[A-Za-z'"*]/.test(c)) {
      let j = i + 1;
      while (j < n && !/[\s()<>[\]/%]/.test(content[j] ?? " ")) j += 1;
      const word = content.slice(i, j);
      i = j;
      if (c === "/") { stack.push(word); continue; }
      const last = stack[stack.length - 1];
      if (word === "Tj") out += showArgs(last);
      else if (word === "TJ") out += showArgs(last);
      else if (word === "'") { nl(); out += showArgs(last); }
      else if (word === '"') { nl(); out += showArgs(last); }
      else if (word === "T*") nl();
      else if (word === "Td" || word === "TD") {
        const ty = Number(stack[stack.length - 1]);
        const tx = Number(stack[stack.length - 2]);
        if (Number.isFinite(ty) && ty !== 0) nl();
        else if (Number.isFinite(tx) && tx > 0 && out !== "" && !/[\s]$/.test(out)) out += " ";
      } else if (word === "Tm") {
        const y = Number(stack[stack.length - 1]);
        if (Number.isFinite(y)) {
          if (lastY !== null && Math.abs(y - lastY) > 0.5) nl();
          else if (lastY !== null && out !== "" && !/[\s]$/.test(out)) out += " ";
          lastY = y;
        }
      } else if (word === "ET") nl();
      stack.length = 0;
      continue;
    }
    if (/[-+.\d]/.test(c)) {
      const m = /^[-+]?\d*\.?\d+/.exec(content.slice(i, i + 24));
      if (m) { stack.push(Number(m[0])); i += m[0].length; } else i += 1;
      continue;
    }
    i += 1;
  }
  return out.replace(/[ \t]+\n/g, "\n").trimEnd();
}

/** The text layer of the pages of a simple PDF (Flate or plain content streams, one-byte fonts), pages in file order separated by a form feed. */
export function pdfTextPure(b: Uint8Array): { text: string; pages: number } {
  const objs = pdfObjects(b);
  const pageNos = [...objs.entries()].filter(([, o]) => isPage(o.dict)).map(([no]) => no).sort((a, c) => a - c);
  const texts: string[] = [];
  for (const no of pageNos) {
    const dict = objs.get(no)?.dict ?? "";
    const refs = [...(/\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(dict)?.[1] ?? "").matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));
    let page = "";
    for (const r of refs) {
      const s = objs.get(r)?.stream;
      if (s) page += `${contentText(latin1(s))}\n`;
    }
    texts.push(page.trimEnd());
  }
  const pages = Math.max(pdfPageCount(b), texts.length);
  return { text: texts.join("\f"), pages };
}

// ---- kinds --------------------------------------------------------------------------------------------------

export type Kind = "image" | "pdf" | "office" | "text" | "other";
export type OfficeType = "docx" | "pptx" | "xlsx" | "odf" | "legacy";

const TEXT_EXT = new Set(["txt", "md", "markdown", "csv", "tsv", "json", "yaml", "yml", "xml", "html", "htm", "css", "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java", "c", "h", "cpp", "hpp", "cs", "php", "sh", "bash", "zsh", "sql", "log", "ini", "toml", "env", "conf", "cfg", "svg", "tex", "rst"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "heic", "heif", "avif"]);

const extOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
};

export function classify(name: string, mime: string): { kind: Kind; office?: OfficeType } {
  const ext = extOf(name);
  const m = mime.toLowerCase();
  if (m === "image/svg+xml" || ext === "svg") return { kind: "text" };
  if (m.startsWith("image/") || IMAGE_EXT.has(ext)) return { kind: "image" };
  if (m === "application/pdf" || ext === "pdf") return { kind: "pdf" };
  if (ext === "docx" || m.includes("wordprocessingml")) return { kind: "office", office: "docx" };
  if (ext === "pptx" || m.includes("presentationml")) return { kind: "office", office: "pptx" };
  if (ext === "xlsx" || m.includes("spreadsheetml")) return { kind: "office", office: "xlsx" };
  if (["odt", "ods", "odp"].includes(ext) || m.startsWith("application/vnd.oasis.opendocument")) return { kind: "office", office: "odf" };
  if (["doc", "xls", "ppt", "rtf", "pages", "numbers", "key"].includes(ext) || m === "application/msword" || m === "application/vnd.ms-excel" || m === "application/vnd.ms-powerpoint" || m === "application/rtf") return { kind: "office", office: "legacy" };
  if (m.startsWith("text/") || m === "application/json" || m === "application/xml" || m.endsWith("+json") || m.endsWith("+xml") || m === "application/x-yaml" || m === "application/javascript" || TEXT_EXT.has(ext)) return { kind: "text" };
  return { kind: "other" };
}

// ---- reading the file ---------------------------------------------------------------------------------------

interface Loaded { bytes: Uint8Array; mime: string; version: number; name: string }

type FailReason = "unsupported" | "too_large" | "corrupt" | "converter_down" | "timeout";

class PreviewFail extends Error {
  readonly reason: FailReason;
  constructor(reason: FailReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

/** The version number to preview: the one asked for, else the file's current one (and its size, to refuse a huge file before reading it). */
async function versionNumber(ctx: Ctx, fileId: string, versionId: string | undefined): Promise<{ n: number; size?: number }> {
  if (versionId !== undefined) {
    const rows = list(obj(await ctx.call("files.versions", { fileId }))["versions"]).map((v) => obj(v));
    const hit = rows.find((v) => str(v["versionId"]) === versionId);
    if (!hit) return fail(ctx, "validation.not_found", "That version is not on this file.");
    return { n: num(hit["n"]) };
  }
  const file = obj(obj(await ctx.call("files.get", { fileId }))["file"]);
  return { n: num(file["version"]), size: num(file["size"]) };
}

async function loadFile(ctx: Ctx, fileId: string, versionId: string | undefined): Promise<Loaded> {
  const meta = obj(obj(await ctx.call("files.get", { fileId }))["file"]);
  let first = obj(await ctx.call("files.read", { fileId, ...(versionId !== undefined ? { versionId } : {}), as: "base64", offset: 0, length: CHUNK }));
  const size = num(first["size"]);
  if (size > MAX_BYTES) throw new PreviewFail("too_large", "This file is too large to preview.");
  const parts: Buffer[] = [Buffer.from(str(first["base64"]), "base64")];
  let got = parts[0]?.length ?? 0;
  const version = num(first["version"]);
  while (got < size) {
    first = obj(await ctx.call("files.read", { fileId, ...(versionId !== undefined ? { versionId } : {}), as: "base64", offset: got, length: CHUNK }));
    const part = Buffer.from(str(first["base64"]), "base64");
    if (part.length === 0) break;
    parts.push(part);
    got += part.length;
  }
  return { bytes: new Uint8Array(Buffer.concat(parts)), mime: str(obj(first)["mime"]) || str(meta["mime"]), version, name: str(meta["name"]) };
}

// ---- converters ---------------------------------------------------------------------------------------------

async function scratch<T>(d: PreviewDrivers, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(d.tmpDir ?? os.tmpdir(), "vyre-prev-"));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function failOf(res: ExecResult, what: string): PreviewFail {
  if (res.code === 127) return new PreviewFail("converter_down", `${what} is not installed on the server.`);
  if (res.code === 124) return new PreviewFail("timeout", `${what} took too long.`);
  return new PreviewFail("corrupt", `${what} could not read this file.`);
}

async function vipsThumb(d: PreviewDrivers, bytes: Uint8Array, width: number): Promise<Raster | null> {
  return scratch(d, async (dir) => {
    const input = path.join(dir, "in");
    const output = path.join(dir, "out.png");
    fs.writeFileSync(input, bytes);
    const res = await d.exec([tool(d, "vips"), input, "-s", `${width}x${width * 10}>`, "-o", output], { cwd: dir, timeoutMs: TOOL_MS });
    if (res.code !== 0 || !fs.existsSync(output)) throw failOf(res, "The picture converter");
    return decodePng(new Uint8Array(fs.readFileSync(output)));
  });
}

/** A picture scaled down to `width` (never up) as PNG bytes. PNG is done here; other formats need vipsthumbnail. */
export async function thumbnailOf(d: PreviewDrivers, bytes: Uint8Array, width: number): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const dim = probeImage(bytes);
  if (!dim || dim.width < 1 || dim.height < 1) throw new PreviewFail("corrupt", "This picture could not be read.");
  if (dim.width * dim.height > MAX_PIXELS * 4) throw new PreviewFail("too_large", "This picture is too large to preview.");
  if (dim.mime === "image/png") {
    const r = decodePng(bytes);
    if (r) {
      if (r.width <= width && bytes.length <= 1_500_000) return { bytes, width: r.width, height: r.height };
      const s = scaleRaster(r, width);
      return { bytes: encodePng(s), width: s.width, height: s.height };
    }
  }
  const r = await vipsThumb(d, bytes, width);
  if (!r) throw new PreviewFail("corrupt", "This picture could not be read.");
  return { bytes: encodePng(r), width: r.width, height: r.height };
}

async function pdftoppmPage(d: PreviewDrivers, pdf: Uint8Array, page: number, width: number): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  return scratch(d, async (dir) => {
    const input = path.join(dir, "in.pdf");
    const prefix = path.join(dir, "page");
    fs.writeFileSync(input, pdf);
    const res = await d.exec([tool(d, "pdftoppm"), "-png", "-singlefile", "-f", String(page), "-l", String(page), "-scale-to-x", String(width), "-scale-to-y", "-1", input, prefix], { cwd: dir, timeoutMs: TOOL_MS });
    const out = `${prefix}.png`;
    if (res.code !== 0 || !fs.existsSync(out)) throw failOf(res, "The PDF converter");
    const bytes = new Uint8Array(fs.readFileSync(out));
    const dim = probeImage(bytes);
    if (!dim) throw new PreviewFail("corrupt", "The PDF page could not be drawn.");
    return { bytes, width: dim.width, height: dim.height };
  });
}

async function pdftotext(d: PreviewDrivers, pdf: Uint8Array): Promise<string | null> {
  return scratch(d, async (dir) => {
    const input = path.join(dir, "in.pdf");
    fs.writeFileSync(input, pdf);
    const res = await d.exec([tool(d, "pdftotext"), "-enc", "UTF-8", input, "-"], { cwd: dir, timeoutMs: TOOL_MS });
    return res.code === 0 ? res.stdout : null;
  });
}

/** Office file to PDF bytes through soffice. */
async function officeToPdf(d: PreviewDrivers, bytes: Uint8Array, name: string): Promise<Uint8Array> {
  return scratch(d, async (dir) => {
    const ext = extOf(name) || "bin";
    const input = path.join(dir, `in.${ext}`);
    fs.writeFileSync(input, bytes);
    const res = await d.exec([tool(d, "soffice"), "--headless", "--norestore", "--convert-to", "pdf", "--outdir", dir, input], { cwd: dir, env: { HOME: dir }, timeoutMs: 3 * TOOL_MS });
    const out = path.join(dir, "in.pdf");
    if (res.code !== 0 || !fs.existsSync(out)) throw failOf(res, "The document converter");
    return new Uint8Array(fs.readFileSync(out));
  });
}

// ---- the cache ----------------------------------------------------------------------------------------------

interface Made extends StoredImage { size: SizeKey }

function filesRow(ctx: Ctx, fileId: string, version: number): Row | undefined {
  return (ctx.db.all("SELECT * FROM previews_file WHERE file_id = ? AND version = ?", fileId, version) as Row[])[0];
}

function putFile(ctx: Ctx, fileId: string, version: number, f: { versionId?: string; state: "ready" | "failed"; reason?: string; pages?: number; source: string; text?: string; truncated?: boolean }): void {
  ctx.db.run("DELETE FROM previews_file WHERE file_id = ? AND version = ?", fileId, version);
  ctx.db.run(
    "INSERT INTO previews_file (file_id, version, version_id, state, reason, pages, source, text, text_truncated, width, height, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    fileId, version, f.versionId ?? null, f.state, f.reason ?? null, f.pages ?? null, f.source, f.text ?? null, f.truncated ? 1 : 0, null, null, ctx.now(),
  );
}

/** Older versions keep their previews until a newer one is made; then only the latest two stay. */
async function trimOld(ctx: Ctx, fileId: string, keepFrom: number): Promise<void> {
  for (const r of ctx.db.all("SELECT * FROM previews_file WHERE file_id = ?", fileId) as Row[]) {
    if (num(r["version"]) >= keepFrom) continue;
    await dropImages(ctx, fileId, num(r["version"]));
    ctx.db.run("DELETE FROM previews_file WHERE file_id = ? AND version = ?", fileId, r["version"]);
  }
}

async function versionIdOf(ctx: Ctx, fileId: string, version: number, given: string | undefined): Promise<string | undefined> {
  if (given !== undefined) return given;
  try {
    const rows = list(obj(await ctx.call("files.versions", { fileId }))["versions"]).map((v) => obj(v));
    return str(rows.find((v) => num(v["n"]) === version)?.["versionId"]) || undefined;
  } catch {
    return undefined;
  }
}

// ---- making a preview ---------------------------------------------------------------------------------------

interface Rendered {
  text: string;
  truncated: boolean;
  source: "native" | "pdf" | "office" | "none";
  pages?: number;
  made: Made[];
  /** why page images are missing, when the text could still be made */
  imageReason?: FailReason;
}

const clip = (text: string): { text: string; truncated: boolean } => (text.length > MAX_TEXT ? { text: text.slice(0, MAX_TEXT), truncated: true } : { text, truncated: false });

async function renderImage(d: PreviewDrivers, bytes: Uint8Array): Promise<Rendered> {
  const made: Made[] = [];
  const dim = probeImage(bytes);
  if (!dim) throw new PreviewFail("corrupt", "This picture could not be read.");
  const decoded = dim.mime === "image/png" ? decodePng(bytes) : null;
  for (const size of SIZES) {
    const width = SIZE_WIDTH[size];
    if (decoded) {
      // decoded once, scaled for each size; a picture already small enough is kept as it is
      if (decoded.width <= width && bytes.length <= 1_500_000) made.push({ kind: "thumb", size, page: 0, bytes, width: decoded.width, height: decoded.height });
      else {
        const sc = scaleRaster(decoded, width);
        made.push({ kind: "thumb", size, page: 0, bytes: encodePng(sc), width: sc.width, height: sc.height });
      }
      continue;
    }
    const t = await thumbnailOf(d, bytes, width);
    made.push({ kind: "thumb", size, page: 0, bytes: t.bytes, width: t.width, height: t.height });
  }
  return { text: "", truncated: false, source: "none", made };
}

async function renderPdfBytes(d: PreviewDrivers, pdf: Uint8Array, source: "pdf" | "office"): Promise<Rendered> {
  let text: string | null = null;
  try {
    text = await pdftotext(d, pdf);
  } catch {
    text = null;
  }
  const pure = pdfTextPure(pdf);
  const body = text ?? pure.text;
  const pages = Math.max(pure.pages, text !== null ? (text.match(/\f/g) ?? []).length : 0);
  const out: Rendered = { ...clip(body), source: body.trim() === "" ? "none" : source, made: [] };
  if (pages > 0) out.pages = pages;
  try {
    const first = await pdftoppmPage(d, pdf, 1, SIZE_WIDTH.m);
    out.made.push({ kind: "thumb", size: "m", page: 0, ...first }, { kind: "page", size: "m", page: 1, ...first });
  } catch (e) {
    if (e instanceof PreviewFail) out.imageReason = e.reason;
    else throw e;
  }
  return out;
}

export function officeExtract(bytes: Uint8Array, type: OfficeType): Extracted | null {
  if (type === "legacy") return null;
  const z = readZip(bytes);
  if (!z) throw new PreviewFail("corrupt", "This document could not be opened.");
  return type === "docx" ? docxText(z) : type === "pptx" ? pptxText(z) : type === "xlsx" ? xlsxText(z) : odfText(z);
}

async function renderOffice(d: PreviewDrivers, bytes: Uint8Array, name: string, type: OfficeType): Promise<Rendered> {
  const got = officeExtract(bytes, type);
  let out: Rendered;
  if (got) {
    out = { ...clip(got.text), source: got.text.trim() === "" ? "none" : "office", made: [], ...(got.pages !== undefined ? { pages: got.pages } : {}) };
  } else if (type === "legacy") {
    out = { text: "", truncated: false, source: "none", made: [] };
  } else {
    throw new PreviewFail("corrupt", "This document could not be read.");
  }
  try {
    const pdf = await officeToPdf(d, bytes, name);
    const viaPdf = await renderPdfBytes(d, pdf, "office");
    out.made.push(...viaPdf.made);
    if (viaPdf.pages !== undefined) out.pages = viaPdf.pages;
    if (type === "legacy") {
      out.text = viaPdf.text;
      out.truncated = viaPdf.truncated;
      out.source = viaPdf.source;
    }
    if (viaPdf.imageReason) out.imageReason = viaPdf.imageReason;
  } catch (e) {
    if (!(e instanceof PreviewFail)) throw e;
    if (type === "legacy") throw e;
    out.imageReason = e.reason;
  }
  return out;
}

async function renderText(bytes: Uint8Array): Promise<Rendered> {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return { ...clip(text.includes("\u0000") ? "" : text), source: text.includes("\u0000") ? "none" : "native", made: [] };
}

async function renderBytes(d: PreviewDrivers, l: Loaded): Promise<Rendered> {
  const c = classify(l.name, l.mime);
  if (c.kind === "image") return renderImage(d, l.bytes);
  if (c.kind === "pdf") {
    if (ascii(l.bytes, 0, 4) !== "%PDF") throw new PreviewFail("corrupt", "This is not a readable PDF.");
    return renderPdfBytes(d, l.bytes, "pdf");
  }
  if (c.kind === "office") return renderOffice(d, l.bytes, l.name, c.office ?? "legacy");
  if (c.kind === "text") return renderText(l.bytes);
  throw new PreviewFail("unsupported", "There is no preview for this kind of file.");
}

interface Outcome { state: "ready" | "failed"; version: number; reason?: FailReason; rendered?: Rendered }

/** A stored failure for these reasons is final; the others (a missing converter, a timeout) are tried again on the next read. */
const FINAL = new Set(["unsupported", "too_large", "corrupt"]);

/** Makes (or reads from the cache) the preview of one version. Never throws for a file that cannot be previewed: that is a stored failure. */
async function ensureRendered(ctx: Ctx, fileId: string, versionId: string | undefined, force: boolean): Promise<Outcome> {
  const d = drivers();
  await sweepGc(ctx);
  const asked = await versionNumber(ctx, fileId, versionId);
  return exclusive(`render:${fileId}`, async () => {
    const hit = filesRow(ctx, fileId, asked.n);
    if (hit && !force && (hit["state"] === "ready" || FINAL.has(str(hit["reason"])))) {
      ctx.db.run("DELETE FROM previews_queue WHERE file_id = ? AND version = ?", fileId, asked.n);
      return { state: hit["state"] === "ready" ? "ready" : "failed", version: asked.n, ...(hit["state"] === "failed" ? { reason: str(hit["reason"]) as FailReason } : {}) };
    }
    const failed = async (version: number, reason: FailReason): Promise<Outcome> => {
      const vid = await versionIdOf(ctx, fileId, version, versionId);
      await dropImages(ctx, fileId, version);
      putFile(ctx, fileId, version, { state: "failed", reason, source: "none", ...(vid !== undefined ? { versionId: vid } : {}) });
      ctx.db.run("DELETE FROM previews_queue WHERE file_id = ? AND version = ?", fileId, version);
      ctx.emit("preview.failed", `file/${fileId}`, { fileId, versionId: vid ?? "ver_unknown", reason });
      return { state: "failed", version, reason };
    };
    if (asked.size !== undefined && asked.size > MAX_BYTES) return failed(asked.n, "too_large");
    let l: Loaded;
    try {
      l = await loadFile(ctx, fileId, versionId);
    } catch (e) {
      if (e instanceof PreviewFail) return failed(asked.n, e.reason);
      throw e;
    }
    const vid = await versionIdOf(ctx, fileId, l.version, versionId);
    try {
      const r = await renderBytes(d, l);
      await dropImages(ctx, fileId, l.version);
      for (const m of r.made) await putImage(ctx, fileId, l.version, m);
      putFile(ctx, fileId, l.version, {
        state: "ready", source: r.source, text: r.text, truncated: r.truncated, ...(r.pages !== undefined ? { pages: r.pages } : {}), ...(vid !== undefined ? { versionId: vid } : {}),
        ...(r.imageReason !== undefined ? { reason: r.imageReason } : r.made.length === 0 ? { reason: "no_image" } : {}),
      });
      await trimOld(ctx, fileId, l.version - 1);
      ctx.db.run("DELETE FROM previews_queue WHERE file_id = ? AND version = ?", fileId, l.version);
      const kinds: string[] = [];
      if (r.made.some((m) => m.kind === "thumb")) kinds.push("thumbnail");
      if (r.made.some((m) => m.kind === "page")) kinds.push("pages");
      if (r.source !== "none") kinds.push("text");
      if (kinds.length > 0) ctx.emit("preview.ready", `file/${fileId}`, { fileId, versionId: vid ?? "ver_unknown", kinds, ...(r.pages !== undefined ? { pages: r.pages } : {}) });
      return { state: "ready", version: l.version, rendered: r };
    } catch (e) {
      if (!(e instanceof PreviewFail)) throw e;
      return failed(l.version, e.reason);
    }
  });
}

/** A page image (or the thumbnail of a PDF or Office file) at a size that was not made yet: converts again and keeps it. */
async function makePage(ctx: Ctx, fileId: string, versionId: string | undefined, version: number, page: number, size: SizeKey): Promise<Row | undefined> {
  const d = drivers();
  return exclusive(`render:${fileId}`, async () => {
    const have = findImage(ctx, fileId, version, "page", size, page);
    if (have) return have;
    const l = await loadFile(ctx, fileId, versionId);
    const c = classify(l.name, l.mime);
    try {
      let pdf: Uint8Array;
      if (c.kind === "pdf") pdf = l.bytes;
      else if (c.kind === "office") pdf = await officeToPdf(d, l.bytes, l.name);
      else return undefined;
      const img = await pdftoppmPage(d, pdf, page, SIZE_WIDTH[size]);
      await putImage(ctx, fileId, version, { kind: "page", size, page, ...img });
      if (page === 1) await putImage(ctx, fileId, version, { kind: "thumb", size, page: 0, ...img });
    } catch (e) {
      if (e instanceof PreviewFail) return undefined;
      throw e;
    }
    return findImage(ctx, fileId, version, "page", size, page);
  });
}

async function makeThumb(ctx: Ctx, fileId: string, versionId: string | undefined, version: number, size: SizeKey): Promise<Row | undefined> {
  const d = drivers();
  return exclusive(`render:${fileId}`, async () => {
    const have = findImage(ctx, fileId, version, "thumb", size, 0);
    if (have) return have;
    const l = await loadFile(ctx, fileId, versionId);
    if (classify(l.name, l.mime).kind !== "image") return undefined;
    try {
      const t = await thumbnailOf(d, l.bytes, SIZE_WIDTH[size]);
      await putImage(ctx, fileId, version, { kind: "thumb", size, page: 0, ...t });
    } catch (e) {
      if (e instanceof PreviewFail) return undefined;
      throw e;
    }
    return findImage(ctx, fileId, version, "thumb", size, 0);
  });
}

// ---- capabilities -------------------------------------------------------------------------------------------

const imageOut = (ctx: Ctx, r: Row): Row => ({ url: blobRef(ctx, r), width: num(r["width"]), height: num(r["height"]) });

function whyNot(row: Row | undefined, outcome: Outcome): string {
  if (outcome.state === "failed") return outcome.reason ?? "unsupported";
  const reason = str(row?.["reason"]);
  return reason !== "" ? reason : "no_image";
}

async function resolve(ctx: Ctx, fileId: string, versionId: string | undefined): Promise<{ outcome: Outcome; row: Row | undefined }> {
  const outcome = await ensureRendered(ctx, fileId, versionId, false);
  return { outcome, row: filesRow(ctx, fileId, outcome.version) };
}

async function get(ctx: Ctx, input: unknown): Promise<Row> {
  const o = record(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  const versionId = optStr(o, "versionId");
  const size = sizeOf(ctx, optStr(o, "size"));
  const page = optInt(ctx, o, "page", 1, 100000);
  const { outcome, row } = await resolve(ctx, fileId, versionId);
  const pages = row && !isNull(row["pages"]) ? { pages: num(row["pages"]) } : {};
  if (outcome.state === "failed") return { ready: false, reason: whyNot(row, outcome) };
  if (page !== undefined && row && !isNull(row["pages"]) && page > num(row["pages"])) return { ready: false, reason: "no_such_page", ...pages };
  let img: Row | undefined;
  if (page !== undefined) {
    img = findImage(ctx, fileId, outcome.version, "page", size, page) ?? (await makePage(ctx, fileId, versionId, outcome.version, page, size));
  } else {
    img = findImage(ctx, fileId, outcome.version, "thumb", size, 0) ?? (await makeThumb(ctx, fileId, versionId, outcome.version, size)) ?? (await makePage(ctx, fileId, versionId, outcome.version, 1, size));
  }
  if (!img) {
    return { ready: false, reason: whyNot(row, outcome), ...pages };
  }
  return { ready: true, ...imageOut(ctx, img), ...pages };
}

async function thumbnails(ctx: Ctx, input: unknown): Promise<{ items: Row[] }> {
  const o = record(ctx, input);
  const ids = list(o["fileIds"]);
  if (ids.length < 1 || ids.length > 200 || !ids.every((x) => typeof x === "string" && x.length > 0)) fail(ctx, "validation.bad_input", "fileIds must be 1 to 200 file ids.");
  const size = sizeOf(ctx, optStr(o, "size"));
  const items: Row[] = [];
  for (const fileId of ids as string[]) {
    try {
      const got = await get(ctx, { fileId, size });
      items.push(got["ready"] === true ? { fileId, ready: true, url: got["url"], width: got["width"], height: got["height"] } : { fileId, ready: false });
    } catch (e) {
      if (!(e instanceof VyreErr)) throw e;
      items.push({ fileId, ready: false });
    }
  }
  return { items };
}

async function pagesOf(ctx: Ctx, input: unknown): Promise<Row> {
  const o = record(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  const versionId = optStr(o, "versionId");
  const from = optInt(ctx, o, "from", 1, 100000) ?? 1;
  const count = optInt(ctx, o, "count", 1, MAX_PAGES_PER_CALL) ?? 10;
  const size = sizeOf(ctx, optStr(o, "size"));
  const { outcome, row } = await resolve(ctx, fileId, versionId);
  const total = row && !isNull(row["pages"]) ? num(row["pages"]) : 0;
  if (outcome.state === "failed" || total === 0) return { total, pages: [] };
  const pages: Row[] = [];
  for (let n = from; n < from + count && n <= total; n++) {
    const img = findImage(ctx, fileId, outcome.version, "page", size, n) ?? (await makePage(ctx, fileId, versionId, outcome.version, n, size));
    if (!img) break;
    pages.push({ n, ...imageOut(ctx, img) });
  }
  return { total, pages };
}

async function textOf(ctx: Ctx, input: unknown): Promise<Row> {
  const o = record(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  const versionId = optStr(o, "versionId");
  const page = optInt(ctx, o, "page", 1, 100000);
  const { outcome, row } = await resolve(ctx, fileId, versionId);
  if (outcome.state === "failed" || !row) return { text: "", truncated: false, source: "none" };
  const raw = str(row["text"]);
  const source = str(row["source"]) || "none";
  const pages = !isNull(row["pages"]) ? { pages: num(row["pages"]) } : {};
  if (page !== undefined) {
    const parts = raw.split("\f");
    return { text: parts.length > 1 ? parts[page - 1] ?? "" : page === 1 ? raw : "", truncated: false, source, ...pages };
  }
  return { text: raw.replace(/\f+$/, "").replace(/\f+/g, "\n\n"), truncated: flag(row["text_truncated"]), source, ...pages };
}

const flag = (v: unknown): boolean => v === 1 || v === true;

async function render(ctx: Ctx, input: unknown): Promise<{ queued: boolean }> {
  const o = record(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  await ensureRendered(ctx, fileId, optStr(o, "versionId"), o["force"] === true);
  return { queued: true };
}

// ---- health -------------------------------------------------------------------------------------------------

/** A one-pixel picture the health probe asks the thumbnail maker to read. */
const SAMPLE_PNG = encodePng({ width: 1, height: 1, data: Uint8Array.from([255, 0, 0, 255]) });

async function present(d: PreviewDrivers, name: "pdftoppm" | "pdftotext" | "soffice" | "vips"): Promise<boolean> {
  const res = await d.exec([tool(d, name), name === "vips" ? "--version" : name === "soffice" ? "--version" : "-v"], { timeoutMs: 8000 });
  return res.code !== 127 && res.code !== 124;
}

async function health(ctx: Ctx, _input: unknown): Promise<Row> {
  const d = drivers();
  const started = Date.now();
  let sampleOk = false;
  try {
    const t = await thumbnailOf(d, SAMPLE_PNG, 8);
    sampleOk = t.width === 1 && t.height === 1;
  } catch {
    sampleOk = false;
  }
  const missing: string[] = [];
  if (!(await present(d, "pdftoppm"))) missing.push("pdftoppm (PDF page images)");
  if (!(await present(d, "soffice"))) missing.push("soffice (Office page images and old Office files)");
  if (!(await present(d, "vips"))) missing.push("vipsthumbnail (JPEG, WebP and GIF thumbnails)");
  const queued = (ctx.db.all("SELECT * FROM previews_queue") as Row[]).length;
  const latencyMs = Date.now() - started;
  if (!sampleOk) return { state: "down", detail: "The thumbnail maker did not answer on the sample file.", latencyMs, queued };
  if (missing.length > 0) return { state: "degraded", detail: `Not installed: ${missing.join(", ")}`, latencyMs, queued };
  if (queued > 500) return { state: "degraded", detail: `${queued} versions are waiting for a preview`, latencyMs, queued };
  return { state: "healthy", latencyMs, queued };
}

export const renderHandlers = {
  "previews.get": (ctx: Ctx, input: unknown) => get(ctx, input),
  "previews.thumbnails": (ctx: Ctx, input: unknown) => thumbnails(ctx, input),
  "previews.pages": (ctx: Ctx, input: unknown) => pagesOf(ctx, input),
  "previews.text": (ctx: Ctx, input: unknown) => textOf(ctx, input),
  "previews.render": (ctx: Ctx, input: unknown) => render(ctx, input),
  "previews.health": (ctx: Ctx, input: unknown) => health(ctx, input),
};
