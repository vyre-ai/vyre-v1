// A screenshot that fits the size limit for a picture kept in Files. Chrome answers a heavy page with a PNG of a megabyte or more; Files refuses a direct write over its limit with `validation.too_large`
// (modules/files/handlers/tree.ts MAX_INLINE, 256 KB), and the agent was left with no picture (13 Nov 2026). fitPng scales the picture down by area average until it fits and says what it did, so a
// normal page always comes back usable. The codec is lib/png.ts, shared with modules/previews; a PNG it cannot read is left as it is.
import { decodePng, encodePng, scaleRaster } from "../../lib/png.ts";

/** The size limit for a picture kept in Files: Files' own MAX_INLINE (modules/files/handlers/tree.ts), less room for the base64 and the file's own record. */
export const SHOT_LIMIT_BYTES = 256 * 1024;
/** The narrowest a picture is scaled to; below it the page is not readable and the agent is told to ask for a part of the page. */
const MIN_WIDTH = 240;

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
    const r = width >= first.width ? first : scaleRaster(first, width);
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
