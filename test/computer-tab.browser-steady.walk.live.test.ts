// The browser preview in the Computer tab keeps its picture and its box (owner, rc.26, 13 Nov 2026: it keeps flickering). Needs the production web export (VYRE_APP_DIST) and Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import { shoot } from "./support/mail-browser.ts";
import { world } from "./support/computer-tab-world.ts";

const DIR = "shots-evidence/computer-tab-bugs";

test(
  "B3 the browser preview keeps its picture and its box: no new address, no blank, no size change",
  { timeout: 240_000 },
  async (t) => {
    const k = await world(t);
    if (!k) return;
    try {
      // every address the picture is asked for, and every time the page asks the Space for a new live view (each is a new ticket, so a new picture that starts from nothing)
      const asked: string[] = [];
      const tickets: string[] = [];
      k.me.page.on("request", (r) => {
        const u = r.url();
        if (/\/browsers\/[^/]+\/stream/.test(u)) asked.push(u);
        if (/\/computers\/browser\/stream/.test(u)) tickets.push(u);
      });
      await k.computerTab();
      // the Computer tab of 14 Nov (fcf16b7d2, 6557cc852): the browser is one self-refreshing picture (browser-picture, its two layers browser-preview-0 and -1) that opens full screen when pressed; the
      // streaming element browser-live-view-image only exists in the full-screen view, so the steady preview is the picture itself
      await k.me.page.getByTestId("browser-picture").waitFor({ timeout: 20_000 });
      // the preview swaps between two layers, so one of them is hidden at any moment: the element is there (attached), the box is visible
      await k.me.page.locator('[data-testid^="browser-preview-"]').first().waitFor({ state: "attached", timeout: 20_000 });
      // watch for 12 s: the picture's box (its size) and whether the picture element is there, sampled every 50 ms
      const log = await k.me.page.evaluate(async () => {
        const out: Array<{ here: boolean; w: number; h: number }> = [];
        const t0 = Date.now();
        while (Date.now() - t0 < 12_000) {
          const here = document.querySelector("[data-testid^=browser-preview-]") !== null;
          const box = (
            document.querySelector("[data-testid=browser-picture]") as HTMLElement | null
          )?.getBoundingClientRect();
          out.push({ here, w: Math.round(box?.width ?? 0), h: Math.round(box?.height ?? 0) });
          await new Promise((r) => setTimeout(r, 50));
        }
        return out;
      });
      await shoot(k.me.page, `${DIR}/b3`, "preview");
      const sizes = new Set(log.map((x) => `${x.w}x${x.h}`));
      assert.equal(log.filter((x) => !x.here).length, 0, "the picture element was gone in some samples");
      assert.equal(sizes.size, 1, `the preview box changed size: ${[...sizes].join(" | ")}`);
      assert.ok(
        tickets.length <= 1, // the preview refreshes by itself with no live ticket (fcf16b7d2, 6557cc852); the walk is that the page never restarts a live view again and again

        `the page asked the Space for a live view ${tickets.length} times (each one starts the picture over): ${tickets.join(" ")}`,
      );
      assert.ok(
        new Set(asked.map((u) => new URL(u).searchParams.get("ticket"))).size <= 1,
        `the picture was asked for under more than one ticket: ${asked.join(" ")}`,
      );
    } finally {
      await k.close();
    }
  },
);
