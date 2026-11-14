// The full-screen terminal's keyboard in the real app (owner, 13 Nov 2026: "put in our own commands or control it if we want it in full screen modal"): you watch until you take the keyboard with one
// deliberate press; a letter only nudges; Return takes it; while you hold, Esc goes to the terminal and the agent's commands wait; Give back returns it; Esc closes the sheet while you only watch; the chord closes
// it while you hold and hands the keyboard back. Needs the production web export (VYRE_APP_DIST) and Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import { shoot } from "./support/mail-browser.ts";
import { world } from "./support/computer-tab-world.ts";

const DIR = "shots-evidence/b-pc";
const ROW = '[data-testid^="row-session-"]';

test(
  "the keyboard: watch, nudge, take with Return, type, Esc stays, give back, Esc closes, the chord closes and hands back",
  { timeout: 300_000 },
  async (t) => {
    const k = await world(t);
    if (!k) return;
    const page = k.me.page;
    const held = async (): Promise<string | undefined> => {
      const o = (await k.w.owner.ok("terminal.list", { host: "agent_computer" })) as {
        terminals: Array<{ agentId?: string; heldBy?: string; state: string }>;
      };
      return o.terminals.find((x) => x.agentId === k.agentId && x.state !== "exited")?.heldBy;
    };
    try {
      await k.computerTab();
      await page.locator(ROW).first().click();
      await page.getByTestId("terminal-popup").waitFor({ timeout: 20_000 });
      const bar = page.getByTestId("terminal-popup-bar");
      await bar.getByText("Nobody is typing").waitFor({ timeout: 10_000 });
      assert.equal(await held(), undefined, "nobody holds it");
      // a letter only nudges: nothing is typed, the keyboard is not taken
      await page.getByTestId("terminal-screen").first().click();
      await page.keyboard.type("x");
      await bar.getByText("Press Take over to type.").waitFor({ timeout: 3_000 });
      assert.equal(await held(), undefined, "a letter does not take the keyboard");
      await shoot(page, DIR, "h-terminal-nudge");
      // Return takes it
      await page.evaluate(() => {
        (window as unknown as { __scr: Element | null }).__scr = document.querySelector("[data-testid=terminal-screen]");
      });
      await page.keyboard.press("Enter");
      await bar.getByText("You have the keyboard").waitFor({ timeout: 10_000 });
      assert.equal(await held(), k.w.owner.id, "the server has the owner at the keyboard");
      const same = await page.evaluate(
        () =>
          (window as unknown as { __scr: Element | null }).__scr === document.querySelector("[data-testid=terminal-screen]"),
      );
      assert.equal(same, true, "taking the keyboard does not rebuild the screen (keys typed at once would be lost)");
      await shoot(page, DIR, "i-terminal-you-hold");
      // the keyboard is on the screen as soon as you take it: no click first
      await page.waitForFunction(
        () => (document.activeElement as HTMLElement | null)?.getAttribute("data-testid") === "terminal-screen",
        undefined,
        { timeout: 5_000 },
      );
      await page.keyboard.type("whoami");
      await page.keyboard.press("Enter");
      await page
        .getByTestId("terminal-screen")
        .getByText("whoami")
        .first()
        .waitFor({ timeout: 10_000 })
        .catch(async (e: unknown) => {
          throw new Error(
            `${String(e)} | popup: ${JSON.stringify(await page.getByTestId("terminal-popup").innerText())} | errors: ${JSON.stringify(k.me.errors)} | input: ${JSON.stringify(await k.w.owner.call("terminal.list", {}))}`,
          );
        });
      // Esc goes to the terminal: the sheet stays
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      assert.equal(
        await page.getByTestId("terminal-popup").count(),
        1,
        "Esc does not close the sheet while you hold the keyboard",
      );
      // give back, then Esc closes
      await page.getByTestId("terminal-give").click();
      await bar.getByText(/Nobody is typing|is typing/).waitFor({ timeout: 10_000 });
      assert.equal(await held(), undefined, "given back");
      await page.keyboard.press("Escape");
      await page.getByTestId("terminal-popup").waitFor({ state: "detached", timeout: 10_000 });
      // the pane's row says who has the keyboard while someone does
      await page.locator(ROW).first().click();
      await page.getByTestId("terminal-take").click();
      await bar.getByText("You have the keyboard").waitFor({ timeout: 10_000 });
      assert.equal(await held(), k.w.owner.id);
      // the chord closes the sheet and hands the keyboard back
      await page.keyboard.press("Meta+Shift+.");
      await page.getByTestId("terminal-popup").waitFor({ state: "detached", timeout: 10_000 });
      for (let i = 0; i < 20 && (await held()) !== undefined; i++) await page.waitForTimeout(250);
      assert.equal(await held(), undefined, "closing while holding hands the keyboard back");
      await k.guard.check("keyboard walk");
    } finally {
      await k.close();
    }
  },
);
