// The Computer tab's terminal is open without a press (owner, 13 Nov 2026: "no one needs to click any attach"). A chat with an agent whose computer has no terminal open: the pane lists its terminal as a row by
// itself, there is no Attach, and pressing the row shows the terminal, which takes a command. Needs the production web export (VYRE_APP_DIST) and Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import { shoot } from "./support/mail-browser.ts";
import { world } from "./support/computer-tab-world.ts";

const DIR = "shots-evidence/computer-tab-bugs";
const ROW = '[data-testid^="row-session-"]';

test(
  "no press needed: the terminal is already there as a row, and it takes a command",
  { timeout: 240_000 },
  async (t) => {
    const k = await world(t, { noTerminal: true });
    if (!k) return;
    try {
      await k.computerTab();
      await k.me.page.locator(ROW).first().waitFor({ timeout: 20_000 });
      assert.equal(await k.me.page.getByText("Attach", { exact: true }).count(), 0, "there is no Attach");
      assert.equal(await k.me.page.getByTestId("terminal-attach").count(), 0);
      // the terminal was opened by the pane itself: the server lists one for this agent without anyone pressing anything
      let listed = 0;
      for (let i = 0; i < 40 && listed === 0; i++) {
        const o = (await k.w.owner.ok("terminal.list", { host: "agent_computer" })) as {
          terminals: Array<{ agentId?: string; state: string }>;
        };
        listed = o.terminals.filter((x) => x.agentId === k.agentId && x.state !== "exited").length;
        if (listed === 0) await new Promise((r) => setTimeout(r, 250));
      }
      assert.equal(listed, 1, "one terminal, opened by the pane, not two");
      await shoot(k.me.page, `${DIR}/auto`, "01-pane");
      await k.me.page.locator(ROW).first().click();
      await k.me.page.getByTestId("terminal-tab").first().waitFor({ timeout: 20_000 });
      // you watch until you take the keyboard
    await k.me.page.getByTestId("terminal-take").click();
    await k.me.page.getByTestId("terminal-give").waitFor({ timeout: 10_000 });
    await k.me.page.waitForFunction(
      () => (document.activeElement as HTMLElement | null)?.getAttribute("data-testid") === "terminal-screen",
      undefined,
      { timeout: 5_000 },
    );
      await k.me.page.keyboard.type("whoami");
      await k.me.page.keyboard.press("Enter");
      await k.me.page.getByTestId("terminal-screen").getByText("whoami").first().waitFor({ timeout: 10_000 });
      await shoot(k.me.page, `${DIR}/auto`, "02-terminal");
      await k.guard.check("terminal open by itself");
    } finally {
      await k.close();
    }
  },
);
