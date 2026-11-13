// An agent's screenshot always comes back usable (13 Nov 2026, owner on rc.26: "the screenshot failed with validation.too_large, because the image was over the size limit for saving"). A heavy page's PNG
// is a megabyte or more and Files refuses a direct write over 256 KB (modules/files/handlers/tree.ts MAX_INLINE). The picture is now scaled down to fit and the agent is told the size it got.
import test from "node:test";
import assert from "node:assert/strict";
import { bindSpaceBrowser } from "../sbrowser/port.ts";
import type { BrowserAnswer, BrowserToolCall, SpaceBrowser } from "../sbrowser/port.ts";
import { resetAgentInfo } from "../sbrowser/agentinfo.ts";
import { decodePng, encodePng } from "../../../lib/png.ts";
import { fitPng, fitPngOffLoop, scaledNote, SHOT_LIMIT_BYTES, TALL_PX } from "../png-fit.ts";
import { DANA, harness } from "../fixtures/harness.ts";
import { tool } from "./tools.fixture.ts";

/** A picture that does not compress, like a photo-heavy page: noise with a little structure. Deterministic. */
function page(width: number, height: number): { base64: string; bytes: number } {
  const data = new Uint8Array(width * height * 4);
  let a = 12345;
  for (let i = 0; i < data.length; i += 4) {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    data[i] = (a >>> 24) & 255; data[i + 1] = (a >>> 16) & 255; data[i + 2] = (a >>> 8) & 255; data[i + 3] = 255;
  }
  const png = encodePng({ width, height, data });
  return { base64: Buffer.from(png).toString("base64"), bytes: png.length };
}

test("a picture over the limit is scaled to fit, keeps its shape, and says what the page is", () => {
  const big = page(1280, 800);
  assert.ok(big.bytes > 2 * SHOT_LIMIT_BYTES, `the test page is heavy (${big.bytes} bytes)`);
  const fit = fitPng(big.base64, { width: 1280, height: 800 });
  assert.ok(fit.ok, "it fits");
  if (!fit.ok) return;
  assert.ok(Buffer.from(fit.shot.base64, "base64").length <= SHOT_LIMIT_BYTES, "under the limit");
  assert.deepEqual([fit.shot.pageWidth, fit.shot.pageHeight], [1280, 800]);
  assert.ok(fit.shot.width < 1280 && Math.abs(fit.shot.width / fit.shot.height - 1.6) < 0.02, `same shape: ${fit.shot.width} x ${fit.shot.height}`);
  assert.ok(Math.abs(fit.shot.scale - fit.shot.width / 1280) < 0.002, `scale is picture pixels per page pixel: ${fit.shot.scale}`);
  const back = decodePng(Buffer.from(fit.shot.base64, "base64"));
  assert.deepEqual([back?.width, back?.height], [fit.shot.width, fit.shot.height], "the scaled picture is a real PNG of the size it says");
  assert.match(scaledNote(fit.shot), /page is 1280 x 800.*Click coordinates are in page pixels: a point on this picture is multiplied by [\d.]+ \(1 \/ scale/);
});

test("a picture under the limit is kept exactly as it is, at scale 1", () => {
  const small = page(64, 40);
  const fit = fitPng(small.base64, { width: 64, height: 40 });
  assert.ok(fit.ok && fit.shot.base64 === small.base64 && fit.shot.scale === 1 && fit.shot.topPx === undefined);
  assert.equal(fit.ok ? scaledNote(fit.shot) : "x", "");
});

test("a very tall page is returned as its top part with the part it shows said, never refused", () => {
  const tall = page(640, 9000);
  const fit = fitPng(tall.base64, { width: 640, height: 9000 });
  assert.ok(fit.ok, `${fit.ok ? "" : fit.why}`);
  if (!fit.ok) return;
  assert.equal(fit.shot.topPx, TALL_PX, "the top 4096 page pixels");
  assert.equal(fit.shot.pageHeight, 9000);
  assert.ok(Buffer.from(fit.shot.base64, "base64").length <= SHOT_LIMIT_BYTES);
  assert.match(scaledNote(fit.shot), /only the top 4096 px of the page/);
});

test("a picture that is not a PNG this can read is refused with words that say what to ask for", () => {
  const odd = fitPng(Buffer.alloc(SHOT_LIMIT_BYTES + 10, 7).toString("base64"), { width: 10, height: 10 });
  assert.ok(!odd.ok && /not one that can be made smaller/.test(odd.why) && /ref/.test(odd.why));
});

test("the click the agent works out from a scaled picture lands on the button", () => {
  // a noisy 1280 x 1600 page with a red button at x 900..1020, y 1100..1160 (page pixels)
  const w = 1280, h = 1600;
  const data = new Uint8Array(w * h * 4);
  let a = 99;
  for (let i = 0; i < data.length; i += 4) { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; data[i] = (a >>> 24) & 127; data[i + 1] = (a >>> 16) & 127; data[i + 2] = (a >>> 8) & 127; data[i + 3] = 255; }
  for (let y = 1100; y < 1160; y++) for (let x = 900; x < 1020; x++) { const i = (y * w + x) * 4; data[i] = 255; data[i + 1] = 0; data[i + 2] = 0; }
  const png = Buffer.from(encodePng({ width: w, height: h, data })).toString("base64");
  const fit = fitPng(png, { width: w, height: h });
  assert.ok(fit.ok && fit.shot.scale < 1);
  if (!fit.ok) return;
  const pic = decodePng(Buffer.from(fit.shot.base64, "base64"))!;
  // find the button on the picture the agent sees: the strongly red pixels
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < pic.height; y++) for (let x = 0; x < pic.width; x++) { const i = (y * pic.width + x) * 4; if (pic.data[i]! > 200 && pic.data[i + 1]! < 60 && pic.data[i + 2]! < 60) { sx += x; sy += y; n++; } }
  assert.ok(n > 4, "the button is on the picture");
  // the rule in the note: multiply picture coordinates by 1 / scale
  const click = { x: Math.round((sx / n) / fit.shot.scale), y: Math.round((sy / n) / fit.shot.scale) };
  assert.ok(click.x >= 900 && click.x < 1020 && click.y >= 1100 && click.y < 1160, `the click ${JSON.stringify(click)} is on the button`);
});

test("the work is done off the event loop: the server keeps running while a long page is made smaller", async () => {
  const big = page(1280, 3000);
  let ticks = 0;
  const timer = setInterval(() => { ticks++; }, 5);
  const off = await fitPngOffLoop(big.base64, { width: 1280, height: 3000 });
  clearInterval(timer);
  const inline = fitPng(big.base64, { width: 1280, height: 3000 });
  assert.ok(off.ok && inline.ok && off.shot.base64 === inline.shot.base64, "the same picture as the plain function");
  assert.ok(ticks >= 5, `the loop ran ${ticks} timer ticks while the picture was worked on`);
});

// the agent's tool, through the Space browser, with Files that refuses a direct write over its limit as the real one does
function rig(png: string, size: { width: number; height: number }) {
  const calls: BrowserToolCall[] = [];
  const sb = {
    async available() { return true; }, async profiles() { return { profiles: [], maxRunning: 6 }; }, async health() { return { ok: true }; },
    async tool(a: BrowserToolCall): Promise<BrowserAnswer> { calls.push(a); return a.tool === "chrome_screenshot" ? { png, ...size } : { url: "https://www.harborquotes.com/", title: "Harbor", tree: "- page [e1]", truncated: false, ok: true, tabId: "t1", loading: false }; },
    async screenshot() { return { bytes: Buffer.from(png, "base64"), ...size }; },
  } as unknown as SpaceBrowser;
  bindSpaceBrowser(sb);
  const stored: number[] = [];
  const h = harness({
    principal: { kind: "agent", id: "agt_dex" }, actingFor: DANA,
    respond: { "files.create": (i: Record<string, unknown>) => {
      const bytes = Buffer.from(String((i["content"] as { base64: string }).base64), "base64").length;
      if (bytes > SHOT_LIMIT_BYTES) throw Object.assign(new Error("This file is over the size limit for a direct write."), { code: "validation.too_large" });
      stored.push(bytes);
      return { file: { fileId: `fil_shot${stored.length}` } };
    } },
  });
  return { h, stored };
}

test("chrome_screenshot of a heavy page comes back usable: stored under the limit, and the agent is told the size it got", async () => {
  const big = page(1280, 800);
  const { h, stored } = rig(big.base64, { width: 1280, height: 800 });
  try {
    const out = await tool["computers.chrome.screenshot"]!(h.ctx, {});
    assert.ok(out.fileId, "a file came back");
    assert.equal(stored.length, 1);
    assert.ok(stored[0]! <= SHOT_LIMIT_BYTES);
    assert.ok(out.width < 1280 && out.height < 800, `the size it got: ${out.width} x ${out.height}`);
    assert.deepEqual([out.pageWidth, out.pageHeight], [1280, 800], "the page's size, which click coordinates are in");
    assert.ok(out.scale !== undefined && out.scale < 1 && Math.abs(out.scale - out.width / 1280) < 0.002, `scale ${out.scale}`);
    assert.match(out.note ?? "", /page is 1280 x 800.*page pixels/, out.note);
  } finally { resetAgentInfo(); bindSpaceBrowser(null); }
});

test("a normal page's screenshot is stored as it is, with no note", async () => {
  const small = page(320, 200);
  assert.ok(small.bytes <= SHOT_LIMIT_BYTES);
  const { h } = rig(small.base64, { width: 320, height: 200 });
  try {
    const out = await tool["computers.chrome.screenshot"]!(h.ctx, {});
    assert.deepEqual([out.width, out.height, out.note, out.scale], [320, 200, undefined, undefined]);
  } finally { resetAgentInfo(); bindSpaceBrowser(null); }
});

test("a step's picture of a heavy page is kept scaled down, not lost", async () => {
  const big = page(1280, 800);
  const { h, stored } = rig(big.base64, { width: 1280, height: 800 });
  try {
    await tool["computers.chrome.open"]!(h.ctx, { url: "https://www.harborquotes.com/" });
    assert.equal(stored.length, 1, "the step's picture was stored");
    assert.ok(stored[0]! <= SHOT_LIMIT_BYTES);
  } finally { resetAgentInfo(); bindSpaceBrowser(null); }
});
