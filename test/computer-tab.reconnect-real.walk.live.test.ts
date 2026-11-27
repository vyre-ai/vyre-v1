// The live view recovers by itself on the REAL stack (rc.44; owner: "I can't open browser or terminal in Vyre in a stable way"): the real Space browser in Docker, the real daemon's relay, the real app in Chromium. The
// desk is open on the browser; the Space browser's container is stopped under it (what an idle stop or a crash does); the view says Reconnecting, asks for a new address, which starts the browser again, and opens a new
// socket that carries pictures, with NO click (counted on the page's own sockets, not by canvas draws, which any canvas makes). The time from the stop to the first new frame is printed. Needs VYRE_HEAVY_DOCKER=1, VYRE_SPACE_BROWSER_IMAGE (a built space-browser image), the production web export (VYRE_APP_DIST) and Chromium;
// no CI job builds that image for a walk, so this one is not in shots.yml and skips elsewhere.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { shoot } from "./support/mail-browser.ts";
import { world } from "./support/computer-tab-world.ts";

const DIR = "shots-evidence/computer-reconnect-real";

test(
  "the Space browser's container is stopped under the open desk: Reconnecting, then a new socket that carries pictures, with no click",
  { timeout: 280_000 },
  async (t) => {
    const image = process.env["VYRE_SPACE_BROWSER_IMAGE"];
    if (process.env["VYRE_HEAVY_DOCKER"] !== "1" || !image) {
      t.skip("needs VYRE_HEAVY_DOCKER=1 and VYRE_SPACE_BROWSER_IMAGE");
      return;
    }
    const k = await world(t, { realBrowser: image });
    if (!k) return;
    try {
      const page = k.me.page;
      // every socket the page opens to a browser view, and the frames each has received: the proof that a new one opened after the stop and carried pictures (the draw count alone could come from any canvas)
      await page.addInitScript(() => {
        const w = window as unknown as { __socks: Array<{ url: string; frames: number; closed: boolean }> };
        w.__socks = [];
        const Native = window.WebSocket;
        window.WebSocket = class extends Native {
          constructor(u: string | URL, p?: string | string[]) {
            super(u, p);
            if (!String(u).includes("/browsers/")) return;
            const rec = { url: String(u), frames: 0, closed: false };
            w.__socks.push(rec);
            this.addEventListener("message", (e) => {
              if (typeof e.data !== "string") rec.frames++;
            });
            this.addEventListener("close", () => {
              rec.closed = true;
            });
          }
        } as typeof WebSocket;
      });
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
      await page.getByTestId("browser-picture").waitFor({ timeout: 30_000 });
      await page.getByTestId("browser-picture").click();
      await page.getByTestId("desk-live").waitFor({ timeout: 15_000 });
      await page.waitForFunction(() => (window as unknown as { __draws: number }).__draws > 20, undefined, {
        timeout: 30_000,
      });
      await shoot(page, DIR, "01-live");
      const socks = (): Promise<Array<{ url: string; frames: number; closed: boolean }>> =>
        page.evaluate(
          () => (window as unknown as { __socks: Array<{ url: string; frames: number; closed: boolean }> }).__socks,
        );
      const nBefore = (await socks()).length;
      const t0 = Date.now();
      execFileSync("docker", ["stop", "-t", "2", k.dockerName], { stdio: "ignore" });
      await page.getByTestId("browser-live-view-state").waitFor({ timeout: 15_000 });
      assert.match((await page.getByTestId("browser-live-view-state").textContent()) ?? "", /Reconnecting/);
      await shoot(page, DIR, "02-reconnecting");
      // no press anywhere from here: the view opens a new address, which starts the browser again
      await page.getByTestId("browser-live-view-state").waitFor({ state: "detached", timeout: 90_000 });
      await page.waitForFunction(
        (n) => {
          const s = (window as unknown as { __socks: Array<{ frames: number }> }).__socks;
          return s.length > n && s[s.length - 1]!.frames > 0;
        },
        nBefore,
        {
          timeout: 60_000,
        },
      );
      const recoveredMs = Date.now() - t0;
      const after = await socks();
      assert.ok(
        after.length > nBefore,
        `a new browser socket was opened by the view (${nBefore} before, ${after.length} after)`,
      );
      assert.ok(after.at(-1)!.frames > 0, "and it carried pictures");
      console.log(
        `RECOVERY the Space browser stopped under the open desk: first new frame after ${recoveredMs} ms, no click`,
      );
      await shoot(page, DIR, "03-back");
      await k.guard.check();
    } finally {
      await k.close();
    }
  },
);

// Not walked here: a daemon killed and started again under the open desk. This harness restarts the daemon inside the test's own process (test/support/mail-world.ts restart), and the computers module keeps
// process-wide state (room claims, the bound Space browser) that still holds the old daemon's closed database, so the first call after it fails with "database is not open" whatever the view does. A real kill is a
// new process; it is covered at the API level (test/computer-open.soak.heavy.test.ts, ten restarts, terminal and browser reopen each time) and its effect on a socket by the stand-in walk's outage
// (test/computer-tab.reconnect.walk.live.test.ts), and a Space that stops now ends every live view first (browserStream.endAll, terminalStream.endAll) so a viewer sees it go at once.
