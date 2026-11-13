// An agent's screenshot always comes back usable (13 Nov 2026, owner on rc.26: "the screenshot failed with validation.too_large, because the image was over the size limit for saving"). A heavy page's PNG
// is a megabyte or more and Files refuses a direct write over 256 KB (modules/files/handlers/tree.ts MAX_INLINE). The picture is now scaled down to fit and the agent is told the size it got.
import test from "node:test";
import assert from "node:assert/strict";
import { bindSpaceBrowser } from "../sbrowser/port.ts";
import type { BrowserAnswer, BrowserToolCall, SpaceBrowser } from "../sbrowser/port.ts";
import { resetAgentInfo } from "../sbrowser/agentinfo.ts";
import { decodePng, encodePng, fitPng, SHOT_LIMIT_BYTES } from "../png-fit.ts";
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

test("a picture over the limit is scaled to fit, keeps its shape, and says what it was", () => {
  const big = page(1280, 800);
  assert.ok(big.bytes > 2 * SHOT_LIMIT_BYTES, `the test page is heavy (${big.bytes} bytes)`);
  const fit = fitPng(big.base64, { width: 1280, height: 800 });
  assert.ok(fit.ok, "it fits");
  if (!fit.ok) return;
  assert.ok(Buffer.from(fit.shot.base64, "base64").length <= SHOT_LIMIT_BYTES, "under the limit");
  assert.deepEqual(fit.shot.scaledFrom, { width: 1280, height: 800 });
  assert.ok(fit.shot.width < 1280 && Math.abs(fit.shot.width / fit.shot.height - 1.6) < 0.02, `same shape: ${fit.shot.width} x ${fit.shot.height}`);
  const back = decodePng(Buffer.from(fit.shot.base64, "base64"));
  assert.deepEqual([back?.width, back?.height], [fit.shot.width, fit.shot.height], "the scaled picture is a real PNG of the size it says");
});

test("a picture under the limit is kept exactly as it is", () => {
  const small = page(64, 40);
  const fit = fitPng(small.base64, { width: 64, height: 40 });
  assert.ok(fit.ok && fit.shot.base64 === small.base64 && fit.shot.scaledFrom === undefined);
});

test("a picture that cannot be made small enough, or is not a PNG, is refused with words that say what to ask for", () => {
  const tall = page(640, 8000);
  const fit = fitPng(tall.base64, { width: 640, height: 8000 });
  assert.ok(!fit.ok && /256 KB/.test(fit.why) && /ref|fullPage/.test(fit.why), `${fit.ok ? "fitted" : fit.why}`);
  const odd = fitPng(Buffer.alloc(SHOT_LIMIT_BYTES + 10, 7).toString("base64"), { width: 10, height: 10 });
  assert.ok(!odd.ok && /not one that can be made smaller/.test(odd.why));
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
    assert.match(out.note ?? "", /1280 x 800.*scaled to \d+ x \d+.*256 KB/, out.note);
  } finally { resetAgentInfo(); bindSpaceBrowser(null); }
});

test("a normal page's screenshot is stored as it is, with no note", async () => {
  const small = page(320, 200);
  assert.ok(small.bytes <= SHOT_LIMIT_BYTES);
  const { h } = rig(small.base64, { width: 320, height: 200 });
  try {
    const out = await tool["computers.chrome.screenshot"]!(h.ctx, {});
    assert.deepEqual([out.width, out.height, out.note], [320, 200, undefined]);
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
