// Taking the keyboard is OFF by default in rc.28 (re-sent keys are not idempotent yet): a person opens an agent's terminal from the Computer tab and sees a watching view, with no Take over control. Needs the
// production web export (VYRE_APP_DIST), Chromium and tmux.
import test from "node:test";
import assert from "node:assert/strict";
import { shoot } from "./support/mail-browser.ts";
import { world } from "./support/computer-tab-world.ts";

delete process.env["VYRE_TERMINAL_TAKEOVER"];
const DIR = "shots-evidence/b-pc-off";
const ROW = '[data-testid^="row-session-"]';

test(
  "take-over off: the terminal sheet only watches (no Take over, no who-is-typing bar), the ended state stays",
  { timeout: 240_000 },
  async (t) => {
    const k = await world(t, { tmux: true });
    if (!k) return;
    const page = k.me.page;
    try {
      await k.computerTab();
      await page.locator(ROW).first().waitFor({ timeout: 30_000 });
      await shoot(page, DIR, "a-pane");
      await page.locator(ROW).first().click();
      await page.getByTestId("terminal-popup").waitFor({ timeout: 20_000 });
      await page.getByTestId("terminal-screen").waitFor({ timeout: 20_000 });
      await page.waitForTimeout(800);
      assert.equal(await page.getByTestId("terminal-take").count(), 0, "no Take over");
      assert.equal(await page.getByText("Take over", { exact: false }).count(), 0, "no Take over anywhere");
      assert.equal(await page.getByText(/Nobody is typing|is typing/).count(), 0, "no who-is-typing bar");
      assert.ok(await page.getByTestId("terminal-popup-close").count(), "Close stays");
      // a letter does nothing: there is nothing to type into
      await page.keyboard.type("x");
      await page.waitForTimeout(300);
      assert.equal(await page.getByText("Press Take over to type.").count(), 0);
      await shoot(page, DIR, "b-sheet-watching");
      // at phone width the sheet is a watching view too
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(800);
      assert.equal(await page.getByTestId("terminal-take").count(), 0, "no Take over at phone width");
      await shoot(page, DIR, "d-phone-sheet-watching");
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(500);
      // the ended state stays: its terminal is closed from outside
      const rows = (await k.w.owner.ok("terminal.list", { host: "agent_computer" })) as {
        terminals: Array<{ terminalId: string; agentId?: string; state: string }>;
      };
      for (const r of rows.terminals.filter((x) => x.agentId === k.agentId && x.state !== "exited"))
        await k.w.owner
          .ok("terminal.close", { terminalId: r.terminalId, idempotencyKey: `off-close-${r.terminalId}` })
          .catch(() => undefined);
      await page.getByTestId("terminal-newtab").waitFor({ timeout: 20_000 });
      await shoot(page, DIR, "c-sheet-ended");
      await k.guard.check("take-over off");
    } finally {
      await k.close();
    }
  },
);
