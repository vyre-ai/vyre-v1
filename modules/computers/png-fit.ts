// A screenshot that fits the size limit for a picture kept in Files. Chrome answers a heavy page with a PNG of a megabyte or more; Files refuses a direct write over its limit with `validation.too_large`
// (modules/files/handlers/tree.ts MAX_INLINE, 256 KB), and the agent was left with no picture (13 Nov 2026). fitPng makes the picture fit and says what it did, so a page always comes back usable:
//   - the target size is worked out once from the picture's bytes and pixels (area), and the picture is scaled once; a second and third pass only correct a poor guess;
//   - a very tall page is returned as its top part (TALL_PX), with the part it shows said, never refused;
//   - the work runs in a worker thread (fitPngOffLoop), so a long page does not stop the server's other calls.
// The codec is lib/png.ts, shared with modules/previews; a PNG it cannot read is left as it is.
import { Worker } from "node:worker_threads";
import { decodePng, encodePng, scaleRaster } from "../../lib/png.ts";
import type { Raster } from "../../lib/png.ts";

/** The size limit for a picture kept in Files: Files' own MAX_INLINE (modules/files/handlers/tree.ts), less room for the base64 and the file's own record. */
export const SHOT_LIMIT_BYTES = 256 * 1024;
/** A page taller than this many page pixels is returned as its top part. */
export const TALL_PX = 4096;
/** Passes after the first guess; each is a full scale and encode, so few. */
const CORRECTIONS = 2;
const MIN_WIDTH = 64;
/** A worker that has not answered by now is stopped and the picture is refused with words (a runaway, not a normal page). */
const WORKER_MS = 20_000;

export interface Fitted {
  /** The picture as base64, at most `limit` bytes as PNG. */
  base64: string;
  /** The picture's own size. */
  width: number;
  height: number;
  /** The page's size in page pixels, as the browser measured it (what chrome_click's x and y are in). */
  pageWidth: number;
  pageHeight: number;
  /** Picture pixels per page pixel; 1 when the picture is the page as it is. */
  scale: number;
  /** Present when only the top of a very tall page is shown: the page pixels shown. */
  topPx?: number;
}

export type Fit = { ok: true; shot: Fitted } | { ok: false; why: string };

const kb = (n: number): string => `${Math.round(n / 1024)} KB`;

/**
 * The picture as it is when it fits `limit` bytes; else its top part (when very tall) scaled down until it does. `size` is the page's size as the browser said it (the picture of a full page is the page).
 * A picture this cannot read, or cannot make small enough, is `ok: false` with the words to give the agent.
 */
export function fitPng(base64: string, size: { width: number; height: number }, limit: number = SHOT_LIMIT_BYTES): Fit {
  const bytes = Buffer.from(base64, "base64");
  const asIs: Fitted = { base64, width: size.width, height: size.height, pageWidth: size.width, pageHeight: size.height, scale: 1 };
  if (bytes.length <= limit) return { ok: true, shot: asIs };
  const limitWords = `the ${kb(limit)} limit for a picture kept in Files`;
  const decoded = decodePng(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length));
  if (!decoded) return { ok: false, why: `The picture is ${kb(bytes.length)}, over ${limitWords}, and it is not one that can be made smaller here. Ask for a smaller part of the page (a ref), or without fullPage.` };
  const pageWidth = size.width > 0 ? size.width : decoded.width;
  const pageHeight = size.height > 0 ? size.height : decoded.height;
  // a very tall page: its top part, cut from the rows (the picture is the page at its own scale, so a row of it is a row of the page)
  const shownRows = Math.min(decoded.height, TALL_PX);
  const first: Raster = shownRows < decoded.height ? { width: decoded.width, height: shownRows, data: decoded.data.subarray(0, decoded.width * shownRows * 4) } : decoded;
  // size follows the pixels: aim a little under the limit from the share of the bytes the shown rows hold, once
  const share = bytes.length * (first.height / decoded.height);
  let width = Math.min(first.width, Math.max(MIN_WIDTH, Math.floor(first.width * Math.sqrt((limit * 0.7) / share))));
  for (let pass = 0; pass <= CORRECTIONS; pass++) {
    const r = width >= first.width ? first : scaleRaster(first, width);
    const out = encodePng(r);
    if (out.length <= limit) {
      const scale = r.width / pageWidth;
      return { ok: true, shot: { base64: Buffer.from(out).toString("base64"), width: r.width, height: r.height, pageWidth, pageHeight, scale: Math.round(scale * 1000) / 1000, ...(shownRows < decoded.height ? { topPx: Math.round(shownRows / (decoded.height / pageHeight)) } : {}) } };
    }
    if (width <= MIN_WIDTH) break;
    // a poor guess: the next size follows how far over this one was
    width = Math.max(MIN_WIDTH, Math.floor(width * Math.sqrt((limit * 0.7) / out.length)));
  }
  return { ok: false, why: `The picture (${pageWidth} x ${pageHeight}) stays over ${limitWords} even when scaled very small. Ask for a smaller part of the page (a ref).` };
}

/** fitPng in a worker thread: the picture is decoded, scaled and encoded off the server's event loop. A picture already within the limit never starts one. */
export function fitPngOffLoop(base64: string, size: { width: number; height: number }, limit: number = SHOT_LIMIT_BYTES): Promise<Fit> {
  if (Buffer.byteLength(base64, "base64") <= limit) return Promise.resolve(fitPng(base64, size, limit));
  return new Promise<Fit>((resolve) => {
    let done = false;
    const finish = (f: Fit): void => { if (!done) { done = true; clearTimeout(timer); void worker?.terminate(); resolve(f); } };
    let worker: Worker | null = null;
    const timer = setTimeout(() => finish({ ok: false, why: "The picture took too long to make smaller. Ask for a smaller part of the page (a ref)." }), WORKER_MS);
    try {
      worker = new Worker(new URL("./png-fit-worker.ts", import.meta.url), { workerData: { base64, size, limit } });
      worker.once("message", (f: Fit) => finish(f));
      worker.once("error", () => finish(fitPng(base64, size, limit)));
    } catch { finish(fitPng(base64, size, limit)); }
  });
}

/** What the agent is told about a picture that is not the page as it is: the rule for turning a point on it into a click. */
export function scaledNote(s: Fitted): string {
  if (s.scale === 1 && s.topPx === undefined) return "";
  const parts: string[] = [];
  parts.push(`The picture is ${s.width} x ${s.height} and the page is ${s.pageWidth} x ${s.pageHeight}.`);
  if (s.topPx !== undefined) parts.push(`It shows only the top ${s.topPx} px of the page; use a ref or scroll for the rest.`);
  parts.push(`Click coordinates are in page pixels: a point on this picture is multiplied by ${Math.round((1 / s.scale) * 1000) / 1000} (1 / scale ${s.scale}).`);
  return parts.join(" ");
}
