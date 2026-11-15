// @heavy docker
// A second person on a shared agent's real computer (rc.29, lane w-computer, 15 Nov 2026): the owner and a person who has only Use on the agent, on a real workspace container. The second person's Computer tab
// shows their own place and their own terminals and never a path or a number of the container; the owner is told, in a count and never a list, that terminals of others are open. Then the same on a phone, and
// the terminal sheet on a phone. Needs VYRE_HEAVY_DOCKER=1, VYRE_WORKSPACE_TEST_IMAGE, the production export (VYRE_APP_DIST) and Chromium. Pictures go to shots-evidence/w-computer/people.
import test from "node:test";
import fs from "node:fs";
import assert from "node:assert/strict";
import { SIZES, open, seat, shoot } from "./support/mail-browser.ts";
import { world } from "./support/computer-tab-world.ts";

const DIR = "shots-evidence/w-computer/people";
fs.rmSync(DIR, { recursive: true, force: true });
const WIDE = { width: 1440, height: 900 };
const IMAGES = process.env["VYRE_HEAVY_DOCKER"] === "1" && process.env["VYRE_WORKSPACE_TEST_IMAGE"] !== undefined;

test(
  "a second person with Use on a shared agent has a place of their own on its computer, and the owner is told in a count",
  { timeout: 300_000 },
  async (t) => {
    if (!IMAGES) {
      t.skip("needs VYRE_HEAVY_DOCKER=1 and VYRE_WORKSPACE_TEST_IMAGE");
      return;
    }
    const k = await world(t, { noTerminal: true, realWorkspace: true });
    if (!k) return;
    const page = k.me.page;
    const text = async (id: string): Promise<string> => (await page.getByTestId(id).innerText()).replace(/\s+/g, " ");
    try {
      // ---- 6 a second person with only Use on the shared agent
      const bea = await k.s.world.join("bea");
      await k.w.owner.ok("terminal.open", { host: "agent_computer", agentId: k.agentId, name: "ada-notes", idempotencyKey: "ada-term" });
      await bea.ok("terminal.open", { host: "agent_computer", agentId: k.agentId, name: "bea-notes", idempotencyKey: "bea-term" });
      const beaSeat = await seat(k.s, bea, "Bea");
      await beaSeat.page.setViewportSize(WIDE);
      const agentPage = `/chat#screen=chats.agent-page&agentId=${k.agentId}&tab=computer`;
      await open(beaSeat, k.s, agentPage);
      await beaSeat.page.getByTestId("terminals-head").waitFor({ timeout: 30_000 });
      await beaSeat.page.waitForTimeout(1500);
      const beaText = (await beaSeat.page.getByTestId("work-list").innerText()).replace(/\s+/g, " ");
      assert.match(beaText, /Your own space on Desk's computer/);
      assert.match(beaText, /Your terminals/);
      assert.equal(await beaSeat.page.getByTestId("row-session-bea-notes").count(), 1, "Bea sees her own terminal");
      assert.equal(await beaSeat.page.getByTestId("row-session-ada-notes").count(), 0, "Bea never sees the owner's");
      assert.doesNotMatch(beaText, /\/people|u2\d{4}|\/home\/agent|read-only|do not have access/);
      await shoot(beaSeat.page, DIR, "second-person-own-place");
      await page.setViewportSize(WIDE);
      await open(k.me, k.s, agentPage);
      await page.getByTestId("terminals-head").waitFor({ timeout: 30_000 });
      await page.waitForTimeout(1500);
      // Bea has the one she opened and the one her own page opened for her: the owner is told, in a count, never a list
      assert.match(await text("terminal-whose"), /terminals? of (other people are|another person is) open here/);
      await shoot(page, DIR, "owner-sees-a-count");
      // the owner's agent page header and the Computer tab, side by side: the header's word is the agent's (its turns), the tab's is the computer's, and neither says Asleep beside a running terminal
      const headerText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      assert.doesNotMatch(headerText, /\bAwake\b/);
      // the phone
      for (const [who, name] of [
        [k.me, "owner"],
        [beaSeat, "bea"],
      ] as const) {
        await who.page.setViewportSize(SIZES.phone);
        await open(who, k.s, agentPage);
        await who.page.getByTestId("agent-page").waitFor({ timeout: 30_000 });
        await who.page.getByText("More", { exact: true }).first().click();
        await who.page.getByText("Computer", { exact: true }).last().click();
        await who.page.getByTestId("terminals-head").waitFor({ timeout: 30_000 });
        await who.page.waitForTimeout(1200);
        await shoot(who.page, DIR, `phone-${name}`);
        if (name === "owner") {
          // the terminal on a phone: the sheet covers the screen and its Close is in reach
          await who.page.locator('[data-testid^="row-session-"]').first().click();
          await who.page.getByTestId("terminal-popup").waitFor({ timeout: 30_000 });
          await who.page.getByTestId("terminal-screen").waitFor({ timeout: 30_000 });
          await who.page.waitForTimeout(800);
          await shoot(who.page, DIR, "phone-terminal");
          await who.page.getByTestId("terminal-popup-close").click();
          await who.page.getByTestId("terminal-popup").waitFor({ state: "detached", timeout: 10_000 });
        }
      }
    } finally {
      await k.close();
    }
  },
);
