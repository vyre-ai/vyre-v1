// The live view recovers by itself (rc.44; owner, 27 Nov: "I can't open browser or terminal in Vyre in a stable way"). The desk is open on the browser; the stream is cut under it (every socket destroyed, new ones and new
// addresses refused for a few seconds, as when the daemon is killed and started again): the view says Reconnecting, and when the service is back it draws again with NO click and the line goes. Then the same with a
// service that stays away: it says it could not reach the browser and offers Try again, which works once the service is back. Pictures under shots-evidence/computer-reconnect. Needs the production web export
// (VYRE_APP_DIST) and Chromium; the Space browser is the stand-in the other Computer tab walks use.
import test from "node:test";
import assert from "node:assert/strict";
import { shoot } from "./support/mail-browser.ts";
import { world } from "./support/computer-tab-world.ts";

const DIR = "shots-evidence/computer-reconnect";

test(
  "the stream is cut under the open desk: Reconnecting, then drawn again with no click; a long outage says so and Try again works",
  { timeout: 240_000 },
  async (t) => {
    const k = await world(t);
    if (!k) return;
    try {
      const page = k.me.page;
      await page.addInitScript(() => {
        const w = window as unknown as { __draws: number };
        w.__draws = 0;
        const draw = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function (...a: unknown[]) {
          w.__draws++;
          return (draw as (...x: unknown[]) => void).apply(this, a);
        };
      });
      await k.computerTab();
      await page.getByTestId("browser-picture").waitFor({ timeout: 20_000 });
      await page.getByTestId("browser-picture").click();
      await page.getByTestId("desk-live").waitFor({ timeout: 10_000 });
      const draws = (): Promise<number> => page.evaluate(() => (window as unknown as { __draws: number }).__draws);
      await page.waitForFunction(() => (window as unknown as { __draws: number }).__draws > 3, undefined, { timeout: 15_000 });
      assert.equal(await page.getByTestId("browser-live-view-state").count(), 0, "nothing is said while it is live");
      await shoot(page, DIR, "01-live");

      // a short cut: the view notices at once (the socket closes), says so, and is back without a press
      const before = await draws();
      const socketsBefore = k.socketsOpened.length;
      k.outage(3000);
      await page.getByTestId("browser-live-view-state").waitFor({ timeout: 10_000 });
      assert.match((await page.getByTestId("browser-live-view-state").textContent()) ?? "", /Reconnecting/);
      await shoot(page, DIR, "02-reconnecting");
      await page.getByTestId("browser-live-view-state").waitFor({ state: "detached", timeout: 30_000 });
      await page.waitForFunction((n) => (window as unknown as { __draws: number }).__draws > n + 3, before, { timeout: 15_000 });
      assert.ok(k.socketsOpened.length > socketsBefore, "a new socket was opened with a new address, no one pressed anything");
      await shoot(page, DIR, "03-back");

      // a long cut: after the give-up time it says it could not reach the browser, with Try again
      k.outage(120_000);
      await page.getByTestId("browser-live-view-state").waitFor({ timeout: 10_000 });
      await page.getByTestId("browser-live-view-retry").waitFor({ timeout: 60_000 });
      assert.match((await page.getByTestId("browser-live-view-state").textContent()) ?? "", /Couldn't reach the browser/);
      await shoot(page, DIR, "04-gave-up");
      k.outage(0);
      await page.getByTestId("browser-live-view-retry").click();
      await page.getByTestId("browser-live-view-state").waitFor({ state: "detached", timeout: 20_000 });
      await shoot(page, DIR, "05-retried");
      await k.guard.check();
    } finally {
      await k.close();
    }
  },
);
