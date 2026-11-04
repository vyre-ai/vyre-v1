// @ts-check
// Screenshots that leave Chrome (the side panel's page chip, Save to Notes, a recorded step, a watch's before and after) with password, card and code fields blacked out
// on this computer first. The worker asks the page where those fields are (sensitiveRects, run in the page), takes the visible tab, and paints a black box over each
// field in the image before anything else sees it (paintMask, in the worker with OffscreenCanvas). If the page cannot be asked, there is no screenshot at all.

/**
 * Run in the page (chrome.scripting): the boxes of every field whose value must never be seen, in CSS pixels of the viewport, plus the device pixel ratio.
 * Self-contained: the browser serializes it.
 */
export function sensitiveRects() {
  const g = /** @type {any} */ (globalThis);
  const doc = g.document;
  const CARD = /^cc-|^(card|credit)/i;
  const SECRET_NAME = /pass(word|code)?|pin\b|cvc|cvv|card.?num|security.?code|otp|one.?time|totp|2fa|mfa|ssn/i;
  /** @type {{ x: number, y: number, w: number, h: number }[]} */
  const rects = [];
  const seen = new Set();
  const add = (/** @type {any} */ el) => {
    if (seen.has(el) || !el.getBoundingClientRect) return;
    seen.add(el);
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    if (r.bottom < 0 || r.right < 0 || r.top > g.innerHeight || r.left > g.innerWidth) return;
    rects.push({ x: r.left - 2, y: r.top - 2, w: r.width + 4, h: r.height + 4 });
  };
  for (const el of doc.querySelectorAll("input, textarea, [contenteditable=true], [data-vyre-private]")) {
    const type = String(el.getAttribute("type") || "").toLowerCase();
    const auto = String(el.getAttribute("autocomplete") || "").toLowerCase();
    const words = `${el.getAttribute("name") || ""} ${el.id || ""} ${el.getAttribute("aria-label") || ""} ${el.getAttribute("placeholder") || ""}`;
    if (el.hasAttribute("data-vyre-private") || type === "password" || CARD.test(auto) || auto === "one-time-code" || auto.includes("password") || (type !== "email" && type !== "search" && SECRET_NAME.test(words))) add(el);
  }
  // Fields inside open shadow roots and same-origin frames are covered too.
  const walk = (/** @type {any} */ root) => {
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) {
        for (const f of el.shadowRoot.querySelectorAll("input[type=password], input[autocomplete^=cc-], input[autocomplete=one-time-code]")) add(f);
        walk(el.shadowRoot);
      }
    }
  };
  walk(doc);
  for (const frame of doc.querySelectorAll("iframe")) {
    let inner = null;
    try { inner = frame.contentDocument; } catch { inner = null; }
    const fr = frame.getBoundingClientRect();
    if (!inner) continue;
    for (const f of inner.querySelectorAll("input[type=password], input[autocomplete^=cc-], input[autocomplete=one-time-code]")) {
      const r = f.getBoundingClientRect();
      rects.push({ x: fr.left + r.left - 2, y: fr.top + r.top - 2, w: r.width + 4, h: r.height + 4 });
    }
  }
  return { rects, dpr: g.devicePixelRatio || 1, vw: g.innerWidth, vh: g.innerHeight };
}

/**
 * CSS-pixel boxes to image-pixel boxes, clipped to the image. The image of the visible tab is the viewport at the device pixel ratio, but Chrome may scale it,
 * so the scale is measured from the image, not trusted from the ratio.
 * @param {{ x: number, y: number, w: number, h: number }[]} rects @param {{ vw: number, vh: number }} view @param {number} imgW @param {number} imgH
 */
export function scaleRects(rects, view, imgW, imgH) {
  const sx = view.vw > 0 ? imgW / view.vw : 1;
  const sy = view.vh > 0 ? imgH / view.vh : 1;
  /** @type {{ x: number, y: number, w: number, h: number }[]} */
  const out = [];
  for (const r of rects) {
    const x = Math.max(0, Math.floor(r.x * sx));
    const y = Math.max(0, Math.floor(r.y * sy));
    const x2 = Math.min(imgW, Math.ceil((r.x + r.w) * sx));
    const y2 = Math.min(imgH, Math.ceil((r.y + r.h) * sy));
    if (x2 > x && y2 > y) out.push({ x, y, w: x2 - x, h: y2 - y });
  }
  return out;
}

/** @param {Blob} blob @returns {Promise<string>} */
async function dataUrlOf(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return `data:${blob.type};base64,${btoa(s)}`;
}

/**
 * Paint the boxes black on a captured image and scale it down to at most `maxW` pixels wide. Runs in the worker (OffscreenCanvas).
 * @param {string} dataUrl @param {{ rects: any[], vw: number, vh: number }} where @param {{ maxW?: number, quality?: number, type?: string }} [o]
 * @returns {Promise<{ dataUrl: string, width: number, height: number, masked: number }>}
 */
export async function paintMask(dataUrl, where, o = {}) {
  const g = /** @type {any} */ (globalThis);
  const m = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl);
  if (!m) throw new Error("not an image");
  const bin = atob(m[2] ?? "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: m[1] });
  const bmp = await g.createImageBitmap(blob);
  const boxes = scaleRects(where.rects, where, bmp.width, bmp.height);
  const full = new g.OffscreenCanvas(bmp.width, bmp.height);
  const c = full.getContext("2d");
  c.drawImage(bmp, 0, 0);
  c.fillStyle = "#17141F";
  for (const b of boxes) c.fillRect(b.x, b.y, b.w, b.h);
  const maxW = o.maxW ?? 1280;
  const scale = Math.min(1, maxW / bmp.width);
  let out = full;
  if (scale < 1) {
    out = new g.OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
    const d = out.getContext("2d");
    d.imageSmoothingQuality = "high";
    d.drawImage(full, 0, 0, out.width, out.height);
  }
  bmp.close?.();
  const jpeg = await out.convertToBlob({ type: o.type ?? "image/jpeg", quality: o.quality ?? 0.8 });
  return { dataUrl: await dataUrlOf(jpeg), width: out.width, height: out.height, masked: boxes.length };
}

/**
 * Take a masked screenshot of a tab that is visible in its window. Null when the page cannot be asked where its secret fields are (then nothing is captured),
 * or the tab is not the visible one.
 * @param {{ tabs: { captureVisibleTab(windowId: number, o: any): Promise<string>, get(id: number): Promise<any> }, scripting: { executeScript(o: any): Promise<any[]> } }} ext
 * @param {number} tabId @param {{ maxW?: number, quality?: number, type?: string, paint?: typeof paintMask }} [o]
 */
export async function maskedShot(ext, tabId, o = {}) {
  const tab = await ext.tabs.get(tabId);
  if (!tab || !tab.active || tab.incognito) return null;
  /** @type {any} */
  let where;
  try {
    const [r] = await ext.scripting.executeScript({ target: { tabId }, func: sensitiveRects, args: [] });
    where = r && r.result;
  } catch { return null; }
  if (!where || !Array.isArray(where.rects)) return null;
  let raw;
  try { raw = await ext.tabs.captureVisibleTab(tab.windowId, { format: "png" }); } catch { return null; }
  // The page could have scrolled between the two calls; ask once more and cover the union.
  try {
    const [again] = await ext.scripting.executeScript({ target: { tabId }, func: sensitiveRects, args: [] });
    if (again && again.result && Array.isArray(again.result.rects)) where = { ...where, rects: [...where.rects, ...again.result.rects] };
  } catch { /* the first answer stands */ }
  return (o.paint ?? paintMask)(raw, where, o);
}
