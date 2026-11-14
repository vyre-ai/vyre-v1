// A small PNG codec for the pictures Vyre makes and shrinks itself (previews' thumbnails, an agent's screenshot): decode a non-interlaced PNG to RGBA, scale it by area average, encode it again.
// Pure functions over bytes; no dependency but node:zlib. Moved here from modules/previews so that modules/computers uses the same one (modules may not import each other).
import { deflateSync, inflateSync } from "node:zlib";

/** Largest picture decoded here, in pixels. */
export const MAX_PIXELS = 60_000_000;

export const u32be = (b: Uint8Array, i: number): number =>
  ((b[i] ?? 0) * 2 ** 24 + (((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0))) >>> 0;
export const ascii = (b: Uint8Array, i: number, n: number): string =>
  String.fromCharCode(...Array.from(b.subarray(i, i + n)));

let crcTable: Uint32Array | null = null;

export function crc32(b: Uint8Array): number {
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

export interface Raster {
  width: number;
  height: number;
  /** RGBA, 8 bits */ data: Uint8Array;
}

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
  if (
    channels === 0 ||
    ![1, 2, 4, 8, 16].includes(depth) ||
    (ct === 3 && (!plte || depth > 8)) ||
    ((ct === 2 || ct === 4 || ct === 6) && depth < 8)
  )
    return null;
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
      const left = x >= step ? (px[dst + x - step] ?? 0) : 0;
      const up = y > 0 ? (px[dst - rowBytes + x] ?? 0) : 0;
      const upLeft = y > 0 && x >= step ? (px[dst - rowBytes + x - step] ?? 0) : 0;
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
        out[o] = g;
        out[o + 1] = g;
        out[o + 2] = g;
        out[o + 3] = 255;
      } else if (ct === 2) {
        out[o] = sample(y, x * 3);
        out[o + 1] = sample(y, x * 3 + 1);
        out[o + 2] = sample(y, x * 3 + 2);
        out[o + 3] = 255;
      } else if (ct === 3) {
        const i = sample(y, x);
        out[o] = plte?.[i * 3] ?? 0;
        out[o + 1] = plte?.[i * 3 + 1] ?? 0;
        out[o + 2] = plte?.[i * 3 + 2] ?? 0;
        out[o + 3] = trns?.[i] ?? 255;
      } else if (ct === 4) {
        const g = sample(y, x * 2);
        out[o] = g;
        out[o + 1] = g;
        out[o + 2] = g;
        out[o + 3] = sample(y, x * 2 + 1);
      } else {
        out[o] = sample(y, x * 4);
        out[o + 1] = sample(y, x * 4 + 1);
        out[o + 2] = sample(y, x * 4 + 2);
        out[o + 3] = sample(y, x * 4 + 3);
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
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      let n = 0;
      for (let y = y0; y < y1 && y < r.height; y++) {
        for (let x = x0; x < x1 && x < r.width; x++) {
          const i = (y * r.width + x) * 4;
          const a = r.data[i + 3] ?? 0;
          sr += (r.data[i] ?? 0) * a;
          sg += (r.data[i + 1] ?? 0) * a;
          sb += (r.data[i + 2] ?? 0) * a;
          sa += a;
          n += 1;
        }
      }
      const o = (dy * tw + dx) * 4;
      if (sa > 0) {
        out[o] = Math.round(sr / sa);
        out[o + 1] = Math.round(sg / sa);
        out[o + 2] = Math.round(sb / sa);
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
  for (let i = 3; i < r.data.length; i += 4)
    if (r.data[i] !== 255) {
      opaque = false;
      break;
    }
  const channels = opaque ? 3 : 4;
  const rowBytes = r.width * channels;
  const raw = new Uint8Array(r.height * (rowBytes + 1));
  for (let y = 0; y < r.height; y++) {
    const o = y * (rowBytes + 1);
    raw[o] = 0;
    for (let x = 0; x < r.width; x++) {
      const s = (y * r.width + x) * 4;
      const d = o + 1 + x * channels;
      raw[d] = r.data[s] ?? 0;
      raw[d + 1] = r.data[s + 1] ?? 0;
      raw[d + 2] = r.data[s + 2] ?? 0;
      if (!opaque) raw[d + 3] = r.data[s + 3] ?? 0;
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, r.width);
  dv.setUint32(4, r.height);
  ihdr[8] = 8;
  ihdr[9] = opaque ? 2 : 6;
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
