// The step bar and the part picker that the extension draws inside a page, in paper and graphite at 1440 and 390, in a real headless Chromium with the unpacked extension. Screenshots go to VYRE_SHOT_DIR.
import test from "node:test";
import assert from "node:assert/strict";
import { findChromium, launch, site } from "./e2e/rig.ts";
import { AGENTS, LAB, lab, openPanelFor } from "./e2e/show-watch.ts";

const found = await findChromium();

for (const [scheme, tone] of [["light", "paper"], ["dark", "graphite"]] as const) {
  test(`the step bar and the part picker drawn in the page, ${tone}`, { skip: !found, timeout: 40_000 }, async () => {
    lab.going = "3,412 going";
    const s = await site({ "/lab": () => LAB() });
    const r = await launch(found!, { colorScheme: scheme, ops: { "agents.list": AGENTS }, caps: { "automations.watches.list": () => ({ watches: [] }) } });
    try {
      const page = await r.context.newPage();
      await page.goto(`${s.url}/lab`);
      await page.bringToFront();
      const panel = await openPanelFor(r, s.url);
      await panel.waitForSelector(".ch.pg .t", { timeout: 10_000 });
      const send = (type: string, extra: Record<string, unknown> = {}) => panel.evaluate(async ({ type, extra }: any) => new Promise((resolve) => (globalThis as any).chrome.runtime.sendMessage({ type, windowId: Number(new URLSearchParams(location.search).get("window")), ...extra }, (x: any) => resolve(x))), { type, extra });
      await send("panel.watch.pick");
      await page.waitForSelector("[data-vyre-pick]", { state: "attached" });
      await page.setViewportSize({ width: 1440, height: 900 });
      const b = (await (await page.$("#going"))!.boundingBox())!;
      await page.mouse.move(b.x + 20, b.y + 10);
      await new Promise((x) => setTimeout(x, 200));
      await r.shot(page, `chrome2b-picker-1440-${tone}`);
      await page.setViewportSize({ width: 390, height: 760 });
      await page.mouse.move(120, 150);
      await new Promise((x) => setTimeout(x, 200));
      await r.shot(page, `chrome2b-picker-390-${tone}`);
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector("[data-vyre-pick]"));
      assert.ok(((await send("panel.rec.start", { name: "Lab" })) as any).data.id);
      await page.waitForSelector("[data-vyre-recbar]", { state: "attached" });
      await page.click("h1");
      await new Promise((x) => setTimeout(x, 400));
      for (const [w, h] of [[1440, 900], [390, 760]] as const) { await page.setViewportSize({ width: w, height: h }); await new Promise((x) => setTimeout(x, 150)); await r.shot(page, `chrome2b-step-bar-${w}-${tone}`); }
      await send("panel.rec.control", { op: "pause" });
      await page.waitForFunction(() => true);
      await new Promise((x) => setTimeout(x, 300));
      await page.setViewportSize({ width: 1440, height: 900 });
      await r.shot(page, `chrome2b-step-bar-paused-1440-${tone}`);
      await send("panel.rec.control", { op: "resume" });
      assert.equal(((await send("panel.rec.state")) as any).data.running, true);
    } finally { await r.close(); await s.close(); }
  });
}

