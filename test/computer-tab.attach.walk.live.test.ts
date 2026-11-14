// A terminal row on the Computer tab shows the terminal full screen over the same chat (owner, rc.26, 13 Nov 2026: Attach sent the tab to the landing page; there is no Attach any more, the row is the way in).
// Needs the production web export (VYRE_APP_DIST) and Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import { shoot } from "./support/mail-browser.ts";
import { world } from "./support/computer-tab-world.ts";

const DIR = "shots-evidence/computer-tab-bugs";
const ROW = '[data-testid^="row-session-"]';

test(
  "B1 a terminal row shows the terminal full screen, never the new tab page, and Esc and Close bring the chat back",
  { timeout: 240_000 },
  async (t) => {
    const k = await world(t);
    if (!k) return;
    const page = k.me.page;
    try {
      await k.computerTab();
      await page.locator(ROW).first().waitFor({ timeout: 20_000 });
      assert.equal(await page.getByText("Attach", { exact: true }).count(), 0, "there is no Attach");
      await shoot(page, `${DIR}/b1`, "before-open");
      await page.locator(ROW).first().click();
      await page.getByTestId("terminal-popup").waitFor({ timeout: 20_000 });
      await page.getByTestId("terminal-tab").first().waitFor({ timeout: 20_000 });
      await shoot(page, `${DIR}/b1`, "after-open");
      assert.equal(await page.getByTestId("newtab-page").count(), 0, "the row did not land on the new tab page");
      const box = await page.getByTestId("terminal-popup").boundingBox();
      const win = page.viewportSize()!;
      assert.ok(box && box.width >= win.width - 2 && box.height >= win.height - 2, "it covers the window");
      await k.guard.check("after the row");
      // Esc closes it; the pane is there as it was
      await page.keyboard.press("Escape");
      await page.getByTestId("terminal-popup").waitFor({ state: "detached", timeout: 10_000 });
      await page.getByTestId("pane-agent").waitFor({ timeout: 10_000 });
      // the row again shows it again, and Close closes it
      await page.locator(ROW).first().click();
      await page.getByTestId("terminal-popup").waitFor({ timeout: 20_000 });
      await shoot(page, `${DIR}/b1`, "03-second-open");
      await page.getByTestId("terminal-popup-close").click();
      await page.getByTestId("terminal-popup").waitFor({ state: "detached", timeout: 10_000 });
      assert.equal(await page.getByTestId("composer-field").count(), 1, "the chat is still the page");
      await k.guard.check("after Close");
    } finally {
      await k.close();
    }
  },
);
