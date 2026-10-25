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
