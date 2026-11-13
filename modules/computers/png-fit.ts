// A screenshot that fits the size limit for a picture kept in Files. Chrome answers a heavy page with a PNG of a megabyte or more; Files refuses a direct write over its limit with `validation.too_large`
// (modules/files/handlers/tree.ts MAX_INLINE, 256 KB), and the agent was left with no picture (13 Nov 2026). fitPng scales the picture down by area average until it fits and says what it did, so a
// normal page always comes back usable. It reads and writes the PNGs Chrome makes (8 bit RGB or RGBA, not interlaced); anything else is left as it is. The same codec lives in modules/previews (modules
// may not import one another); this is the part a screenshot needs.
import { deflateSync, inflateSync } from "node:zlib";

/** The size limit for a picture kept in Files: Files' own MAX_INLINE (modules/files/handlers/tree.ts), less room for the base64 and the file's own record. */
export const SHOT_LIMIT_BYTES = 256 * 1024;
/** Pictures larger than this many pixels are not decoded here (a full page taller than the browser's own 16,000 px cut). */
const MAX_PIXELS = 40_000_000;
/** The narrowest a picture is scaled to; below it the page is not readable and the agent is told to ask for a part of the page. */
const MIN_WIDTH = 240;

interface Raster { width: number; height: number; /** RGBA, 8 bits */ data: Uint8Array }

const u32 = (b: Uint8Array, at: number): number => (((b[at] ?? 0) << 24) | ((b[at + 1] ?? 0) << 16) | ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0)) >>> 0;
const tag = (b: Uint8Array, at: number): string => String.fromCharCode(b[at] ?? 0, b[at + 1] ?? 0, b[at + 2] ?? 0, b[at + 3] ?? 0);

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Uint8Array): number { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = (CRC[(c ^ (b[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** An 8 bit RGB or RGBA PNG that is not interlaced, as RGBA; null for any other PNG, a damaged one or one that is too large to decode. */
export function decodePng(b: Uint8Array): Raster | null {
  if (!(b.length > 33 && b[0] === 137 && tag(b, 1) === "PNG\r")) return null;
  let pos = 8, w = 0, h = 0, depth = 0, ct = -1, interlace = 1;
  const idat: Uint8Array[] = [];
  while (pos + 12 <= b.length) {
    const len = u32(b, pos);
    const type = tag(b, pos + 4);
    const data = b.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") { w = u32(data, 0); h = u32(data, 4); depth = data[8] ?? 0; ct = data[9] ?? -1; interlace = data[12] ?? 1; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  if (w < 1 || h < 1 || w * h > MAX_PIXELS || interlace !== 0 || depth !== 8 || (ct !== 2 && ct !== 6)) return null;
  const bpp = ct === 6 ? 4 : 3;
  const row = w * bpp;
  let raw: Buffer;
  try { raw = inflateSync(Buffer.concat(idat), { maxOutputLength: h * (row + 1) + 16 }); } catch { return null; }
  if (raw.length < h * (row + 1)) return null;
  const px = new Uint8Array(h * row);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (row + 1)] ?? 0;
    const src = y * (row + 1) + 1;
    const dst = y * row;
    for (let x = 0; x < row; x++) {
      const cur = raw[src + x] ?? 0;
      const left = x >= bpp ? px[dst + x - bpp] ?? 0 : 0;
      const up = y > 0 ? px[dst - row + x] ?? 0 : 0;
      const upLeft = y > 0 && x >= bpp ? px[dst - row + x - bpp] ?? 0 : 0;
      let v: number;
      if (ft === 0) v = cur;
      else if (ft === 1) v = cur + left;
      else if (ft === 2) v = cur + up;
      else if (ft === 3) v = cur + ((left + up) >> 1);
      else if (ft === 4) {
        const p = left + up - upLeft, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        v = cur + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      } else return null;
      px[dst + x] = v & 0xff;
    }
  }
  const data = new Uint8Array(w * h * 4);
  for (let i = 0, o = 0; i < px.length; i += bpp, o += 4) { data[o] = px[i] ?? 0; data[o + 1] = px[i + 1] ?? 0; data[o + 2] = px[i + 2] ?? 0; data[o + 3] = bpp === 4 ? px[i + 3] ?? 255 : 255; }
  return { width: w, height: h, data };
}

/** Area-average scaling to the given width; the height keeps the aspect ratio (at least 1 px). */
function scale(r: Raster, tw: number): Raster {
  const th = Math.max(1, Math.round((r.height * tw) / r.width));
  const out = new Uint8Array(tw * th * 4);
  for (let dy = 0; dy < th; dy++) {
    const y0 = Math.floor((dy * r.height) / th);
    const y1 = Math.max(y0 + 1, Math.floor(((dy + 1) * r.height) / th));
    for (let dx = 0; dx < tw; dx++) {
      const x0 = Math.floor((dx * r.width) / tw);
      const x1 = Math.max(x0 + 1, Math.floor(((dx + 1) * r.width) / tw));
      let sr = 0, sg = 0, sb = 0, sa = 0, n = 0;
      for (let y = y0; y < y1 && y < r.height; y++) {
        for (let x = x0; x < x1 && x < r.width; x++) {
          const i = (y * r.width + x) * 4;
          const a = r.data[i + 3] ?? 0;
          sr += (r.data[i] ?? 0) * a; sg += (r.data[i + 1] ?? 0) * a; sb += (r.data[i + 2] ?? 0) * a; sa += a; n += 1;
        }
      }
      const o = (dy * tw + dx) * 4;
      if (sa > 0) { out[o] = Math.round(sr / sa); out[o + 1] = Math.round(sg / sa); out[o + 2] = Math.round(sb / sa); }
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

/** An 8 bit PNG: RGB when nothing is transparent (a page picture never is), else RGBA. */
export function encodePng(r: Raster): Uint8Array {
  let opaque = true;
  for (let i = 3; i < r.data.length; i += 4) if (r.data[i] !== 255) { opaque = false; break; }
  const channels = opaque ? 3 : 4;
  const row = r.width * channels;
  const raw = new Uint8Array(r.height * (row + 1));
  for (let y = 0; y < r.height; y++) {
    const o = y * (row + 1);
    for (let x = 0; x < r.width; x++) {
      const s = (y * r.width + x) * 4, d = o + 1 + x * channels;
      raw[d] = r.data[s] ?? 0; raw[d + 1] = r.data[s + 1] ?? 0; raw[d + 2] = r.data[s + 2] ?? 0;
      if (!opaque) raw[d + 3] = r.data[s + 3] ?? 0;
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, r.width); dv.setUint32(4, r.height); ihdr[8] = 8; ihdr[9] = opaque ? 2 : 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

export interface Fitted {
  /** The picture as base64, at most `limit` bytes as PNG. */
  base64: string;
  width: number;
  height: number;
  /** Present when the picture was made smaller: the size it had. */
  scaledFrom?: { width: number; height: number };
}

export type Fit = { ok: true; shot: Fitted } | { ok: false; why: string };

/**
 * The picture as it is when it fits `limit` bytes; else scaled down (area average, same shape) until it does. `width` and `height` are the picture's own size when the caller knows it (the browser's
 * answer), used for a picture that cannot be read here. A picture that cannot be made small enough, or is not a PNG this can read, is an `ok: false` with the words to give the agent.
 */
export function fitPng(base64: string, size: { width: number; height: number }, limit: number = SHOT_LIMIT_BYTES): Fit {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length <= limit) return { ok: true, shot: { base64, width: size.width, height: size.height } };
  const kb = (n: number): string => `${Math.round(n / 1024)} KB`;
  const limitWords = `the ${kb(limit)} limit for a picture kept in Files`;
  const first = decodePng(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length));
  if (!first) return { ok: false, why: `The picture is ${kb(bytes.length)}, over ${limitWords}, and it is not one that can be made smaller here. Ask for a smaller part of the page (a ref), or without fullPage.` };
  // the size shrinks about with the pixels: aim a little under the limit, then step down until it fits
  let width = Math.min(first.width, Math.max(MIN_WIDTH, Math.floor(first.width * Math.sqrt((limit * 0.8) / bytes.length))));
  for (let i = 0; i < 8; i++) {
    const r = width >= first.width ? first : scale(first, width);
    const out = encodePng(r);
    if (out.length <= limit) return { ok: true, shot: { base64: Buffer.from(out).toString("base64"), width: r.width, height: r.height, scaledFrom: { width: first.width, height: first.height } } };
    if (width <= MIN_WIDTH) break;
    width = Math.max(MIN_WIDTH, Math.floor(width * 0.8));
  }
  return { ok: false, why: `The picture (${first.width} x ${first.height}) stays over ${limitWords} even when scaled to ${MIN_WIDTH} px wide. Ask for a smaller part of the page (a ref), or without fullPage.` };
}

/** One line for the agent about a picture that was made smaller. */
export function scaledNote(s: Fitted): string {
  return s.scaledFrom
    ? `The page picture was ${s.scaledFrom.width} x ${s.scaledFrom.height}; it was scaled to ${s.width} x ${s.height} to fit the ${Math.round(SHOT_LIMIT_BYTES / 1024)} KB limit for a picture kept in Files. Ask for a ref (one element) for full detail.`
    : "";
}
