// esign test helpers: a real PDF to sign, a real PNG to draw with, and the text a PDF draws (hex and literal strings of its show-text operators).
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { deflateSync, inflateSync } from "node:zlib";

export async function samplePdf(pages = 2, label = "Northwind services agreement"): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([612, 792]);
    p.drawText(`${label}, page ${i + 1}`, { x: 60, y: 700, size: 14, font });
  }
  return doc.save({ useObjectStreams: false });
}

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = (crcTable[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
  return out;
}
/** A small valid RGBA PNG: a diagonal blue stroke on a transparent ground. */
export function samplePng(w = 120, h = 40): Uint8Array {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 4 + 1);
    for (let x = 0; x < w; x++) {
      const on = Math.abs(x - (y * w) / h) < 3;
      raw.set(on ? [20, 40, 160, 255] : [0, 0, 0, 0], row + 1 + x * 4);
    }
  }
  const head = new Uint8Array(13);
  const hv = new DataView(head.buffer);
  hv.setUint32(0, w);
  hv.setUint32(4, h);
  head.set([8, 6, 0, 0, 0], 8);
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", head),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** A PNG that passes every header check but cannot be decoded: a palette image with no palette (71 bytes or so). */
export function brokenPng(): Uint8Array {
  const head = new Uint8Array(13);
  const hv = new DataView(head.buffer);
  hv.setUint32(0, 1);
  hv.setUint32(4, 1);
  head.set([8, 3, 0, 0, 0], 8);
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", head),
    chunk("IDAT", deflateSync(new Uint8Array([0, 0]))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Every string a PDF shows with Tj (content streams are inflated first; standard-font text is stored as hex or literal strings). */
export function textOf(pdf: Uint8Array): string {
  const raw = Buffer.from(pdf).toString("latin1");
  let all = raw;
  for (const m of raw.matchAll(/stream\r?\n/g)) {
    const start = (m.index as number) + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) continue;
    try {
      all += `\n${inflateSync(Buffer.from(raw.slice(start, end), "latin1")).toString("latin1")}`;
    } catch {
      /* not a flate stream (an image, a font): nothing to read */
    }
  }
  const out: string[] = [];
  for (const m of all.matchAll(/<([0-9a-fA-F\s]+)>\s*Tj/g))
    out.push(Buffer.from((m[1] as string).replace(/\s+/g, ""), "hex").toString("latin1"));
  for (const m of all.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) out.push(m[1] as string);
  return out.join("\n");
}
