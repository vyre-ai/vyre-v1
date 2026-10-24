// Tiny RGB PNG so a shot proof is a real image without a browser.
// Pixel colour follows --win. A tEXt comment carries a hash of the page so two shots differ.

import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c >>> 0;
}

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = (CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)) >>> 0;
  return (c ^ 0xffffffff) >>> 0;
}

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, sum]);
}

function winRgb(text: string): [number, number, number] {
  const match = /--win:\s*(#[0-9A-Fa-f]{6})/.exec(text);
  const hex = match?.[1] ?? "#808080";
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

/** A 2x2 PNG whose colour is the page's --win and whose comment hashes the page and viewport. */
export function pngFromText(text: string, width: number, height: number): Uint8Array {
  const [r, g, b] = winRgb(text);
  const w = 2;
  const h = 2;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const i = row + 1 + x * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const comment = createHash("sha256").update(text).update(String(width)).update(String(height)).digest("hex").slice(0, 16);
  const textChunk = Buffer.from(`Comment\0${comment}`, "latin1");
  return new Uint8Array(Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("tEXt", textChunk),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]));
}
