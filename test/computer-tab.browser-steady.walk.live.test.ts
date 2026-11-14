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
      const img = k.me.page.getByTestId("browser-live-view-image");
      await img.waitFor({ timeout: 20_000 });
      // watch for 12 s: the picture's box (its size) and whether the picture element is there, sampled every 50 ms
      const log = await k.me.page.evaluate(async () => {
        const out: Array<{ here: boolean; w: number; h: number }> = [];
        const t0 = Date.now();
        while (Date.now() - t0 < 12_000) {
          const here = document.querySelector("[data-testid=browser-live-view-image]") !== null;
          const box = (
            document.querySelector("[data-testid=browser-live]") as HTMLElement | null
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
      assert.equal(
        tickets.length,
        1,
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
