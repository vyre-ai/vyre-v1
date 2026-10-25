import { MARBLE_PATH_1, MARBLE_PATH_2, marbleSpec } from "./faces.ts";
// The face cache for ui/Avatar. A face is drawn once to a bitmap (a PNG data url) keyed by seed, kind, size and skin, then every row that shows it uses an <img>.
// The marble and the Notionists face are blurred, layered svg: drawn inline per row they were the cost that took the Records scroll from 16.8 ms to 66.7 ms.
// Browser only: where there is no document (server render, tests) nothing is cached and the caller draws the inline svg, so markup tests are unchanged.

const bitmaps = new Map<string, string>();
const waiting = new Map<string, Set<() => void>>();

export function faceKey(seed: string, kind: string, size: number, skin: string): string {
  return `${kind}|${size}|${skin}|${seed}`;
}

/** The skin the document wears now ("" when unknown). */
export function currentSkin(): string {
  return typeof document === "undefined" ? "" : document.documentElement.getAttribute("data-skin") ?? "";
}

export function cachedFace(key: string): string | undefined {
  return bitmaps.get(key);
}

/** How many faces are cached, for tests and the speed probe. */
export function cachedFaceCount(): number {
  return bitmaps.size;
}

export function clearFaceCache(): void {
  bitmaps.clear();
  waiting.clear();
}

/** Draws `svg` (a complete svg string) at size x devicePixelRatio, stores the bitmap under `key` and calls `done`. Many rows asking for one key share one draw. */
export function requestFace(key: string, svg: string, size: number, done: () => void): void {
  if (typeof document === "undefined" || typeof Image === "undefined") return;
  if (bitmaps.has(key)) { done(); return; }
  const open = waiting.get(key);
  if (open !== undefined) { open.add(done); return; }
  waiting.set(key, new Set([done]));
  const img = new Image();
  img.onload = () => {
    const ratio = Math.min(3, Math.max(1, Math.ceil((globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1)));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(size * ratio);
    canvas.height = Math.round(size * ratio);
    const ctx = canvas.getContext("2d");
    if (ctx !== null) {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try { bitmaps.set(key, canvas.toDataURL("image/png")); } catch { /* a tainted canvas keeps the inline face */ }
    }
    const who = waiting.get(key);
    waiting.delete(key);
    who?.forEach((cb) => cb());
  };
  img.onerror = () => { waiting.delete(key); };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Wraps svg inner markup (the marble) as a complete svg string at a size. */
export function wrapSvg(inner: string, viewBox: string, size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${size}" height="${size}">${inner}</svg>`;
}

/**
 * The person's marble drawn straight to a bitmap, synchronously, with the canvas (same paths, colours, turns and 7 unit blur as the svg).
 * A row therefore never draws the inline blurred svg in the browser: the first row for a name draws once here, every later row reads the cache.
 * Returns undefined where there is no canvas; the caller then draws the inline svg.
 */
export function marbleBitmap(key: string, name: string, size: number): string | undefined {
  const hit = bitmaps.get(key);
  if (hit !== undefined) return hit;
  if (typeof document === "undefined") return undefined;
  const ratio = Math.min(3, Math.max(1, Math.ceil((globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1)));
  const px = Math.round(size * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (ctx === null || typeof Path2D === "undefined") return undefined;
  const m = marbleSpec(name);
  const k = px / 80;
  ctx.scale(k, k);
  ctx.beginPath();
  ctx.arc(40, 40, 40, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = m.base;
  ctx.fillRect(0, 0, 80, 80);
  const layer = (path: string, fill: string, t: { x: number; y: number; rot: number }, blend: GlobalCompositeOperation): void => {
    ctx.save();
    ctx.filter = `blur(${7 * k}px)`;
    ctx.globalCompositeOperation = blend;
    ctx.translate(t.x, t.y);
    ctx.translate(40, 40);
    ctx.rotate((t.rot * Math.PI) / 180);
    ctx.translate(-40, -40);
    ctx.scale(1.2, 1.2);
    ctx.fillStyle = fill;
    ctx.fill(new Path2D(path));
    ctx.restore();
  };
  layer(MARBLE_PATH_1, m.c1, m.t1, "source-over");
  layer(MARBLE_PATH_2, m.c2, m.t2, "overlay");
  try {
    const url = canvas.toDataURL("image/png");
    bitmaps.set(key, url);
    return url;
  } catch {
    return undefined;
  }
}
