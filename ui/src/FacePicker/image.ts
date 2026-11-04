// An uploaded face: any picture, cropped to the middle square and made small enough to be kept on the agent (a data URL of at most IMG_MAX_CHARS). Browser only; the canvas is injectable for tests.
import { IMG_MAX_CHARS } from "../Avatar/agentface.ts";

export interface Canvasish { width: number; height: number; getContext(k: "2d"): { drawImage(...a: unknown[]): void } | null; toDataURL(type: string, quality: number): string }
export interface ImageDeps {
  bitmap(file: Blob): Promise<{ width: number; height: number; close?(): void }>;
  canvas(): Canvasish;
}

const browser = (): ImageDeps => ({
  bitmap: (f) => (globalThis as unknown as { createImageBitmap(b: Blob): Promise<{ width: number; height: number; close?(): void }> }).createImageBitmap(f),
  canvas: () => (globalThis as unknown as { document: { createElement(t: string): Canvasish } }).document.createElement("canvas"),
});

/** The picture as a webp (or jpeg where webp is not made) data URL, square, shrunk until it fits. Null when the file is not a picture the browser can read or nothing small enough comes out. */
export async function squareDataUrl(file: Blob, deps: ImageDeps = browser()): Promise<string | null> {
  let bmp;
  try { bmp = await deps.bitmap(file); } catch { return null; }
  const side = Math.min(bmp.width, bmp.height);
  if (!(side > 0)) return null;
  const sx = Math.floor((bmp.width - side) / 2), sy = Math.floor((bmp.height - side) / 2);
  for (const edge of [192, 160, 128, 96]) {
    const c = deps.canvas();
    c.width = edge; c.height = edge;
    const ctx = c.getContext("2d");
    if (ctx === null) return null;
    ctx.drawImage(bmp, sx, sy, side, side, 0, 0, edge, edge);
    for (const q of [0.85, 0.7, 0.55, 0.4]) {
      let url = c.toDataURL("image/webp", q);
      if (!url.startsWith("data:image/webp")) url = c.toDataURL("image/jpeg", q);
      if (/^data:image\/(png|jpeg|webp);base64,/.test(url) && url.length <= IMG_MAX_CHARS) { bmp.close?.(); return url; }
    }
  }
  bmp.close?.();
  return null;
}
