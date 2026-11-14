// The Computer tab's browser picture keeps itself fresh without flicker (lead, 13 Nov; AGENT-COMPUTER-2026-11-13.md A5): it asks computers.browser.preview, never wakes a sleeping browser, and while it runs the
// box never changes size and one layer is always visible once the first frame is in. Needs the production web export (VYRE_APP_DIST) and Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./support/computer-tab-world.ts";

test("the pane picture is a self-refreshing still: one box, one layer always visible, nothing wakes while asleep", { timeout: 240_000 }, async (t) => {
  const k = await world(t);
  if (!k) return;
  const page = k.me.page;
  try {
    await k.computerTab();
    await page.getByTestId("browser-preview").waitFor({ timeout: 20_000 });
    const api = await k.w.owner.call("computers.browser.preview", { agentId: k.agentId });
    assert.equal(api.status, 200, `the preview call answered: ${JSON.stringify(api).slice(0, 300)}`);
    assert.equal(api.data.state, "live");
    await page.waitForFunction(
      () => [...document.querySelectorAll("[data-testid^=browser-preview-]")].some((e) => (e as HTMLImageElement).src.startsWith("data:image/png")),
      undefined,
      { timeout: 20_000 },
    );
    const log = await page.evaluate(async () => {
      const out: Array<{ visible: number; w: number; h: number }> = [];
      for (let i = 0; i < 120; i++) {
        const imgs = [...document.querySelectorAll("[data-testid^=browser-preview-]")] as HTMLImageElement[];
        const box = document.querySelector("[data-testid=browser-picture]")!.getBoundingClientRect();
        out.push({ visible: imgs.filter((x) => getComputedStyle(x).visibility === "visible").length, w: Math.round(box.width), h: Math.round(box.height) });
        await new Promise((r) => setTimeout(r, 50));
      }
      return out;
    });
    assert.equal(new Set(log.map((x) => `${x.w}x${x.h}`)).size, 1, "one box size across every sample");
    assert.ok(log.every((x) => x.visible === 1), `one layer visible at every instant: ${JSON.stringify(log.map((x) => x.visible))}`);
    // asleep: no preview request wakes it, and the box keeps its shape
    const row = k.browserd.rows.get(k.agentId)!;
    k.browserd.rows.set(k.agentId, { ...row, running: false });
    await page.getByTestId("browser-caption").getByText(/^Asleep/).waitFor({ timeout: 15_000 });
    const box = await page.getByTestId("browser-picture").boundingBox();
    assert.ok(box && Math.abs(box.width / box.height - 1.6) < 0.02, "the box keeps its 8:5 shape asleep");
    await k.guard.check("preview");
  } finally {
    await k.close();
  }
});
