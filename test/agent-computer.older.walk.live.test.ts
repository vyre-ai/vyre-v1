// The agent's computer when there is no desktop to open and no server to run it (rc.29, lane w-computer, 15 Nov 2026). The Computer tab of an agent that still has an older desktop never offers "Open its desktop"
// (there is one Computer tab: owner ruling 6 Nov 2026, the drawing of 13 Nov has no desktop, and the old door only reopened the page it was on); the one row left removes it, in Console, and goes there. A server
// that cannot run computers says in one plain line who can add one and where. Stand-ins for the container engine (no Docker); the app, the daemon and the capabilities are real. Needs the production export
// (VYRE_APP_DIST) and Chromium. Pictures go to shots-evidence/w-computer/older.
import test from "node:test";
import fs from "node:fs";
import assert from "node:assert/strict";
import { SIZES, open, shoot } from "./support/mail-browser.ts";
import { world } from "./support/computer-tab-world.ts";
import { fakeHost } from "../modules/computers/fixtures/fake-host.ts";
import { bindHost as bindComputers } from "../modules/computers/projections.ts";
import { bindWorkspaceStatus } from "../modules/terminal/projections.ts";
import { bindSpaceBrowser } from "../modules/computers/sbrowser/port.ts";

const DIR = "shots-evidence/w-computer/older";
fs.rmSync(DIR, { recursive: true, force: true });
const WIDE = { width: 1440, height: 900 };

test(
  "an agent that still has an older desktop is never offered a door that opens the page it is on; a server that cannot run computers says who can add one and where",
  { timeout: 240_000 },
  async (t) => {
    const k = await world(t, { noTerminal: true });
    if (!k) return;
    const page = k.me.page;
    try {
      await page.setViewportSize(WIDE);
      const agentPage = `/chat#screen=chats.agent-page&agentId=${k.agentId}&tab=computer`;
      // ---- 4 the older desktop: one Computer tab is the computer (owner ruling 6 Nov 2026, the drawing of 13 Nov has no desktop), so there is no "Open its desktop". The row that is left removes it
      const fake = fakeHost();
      bindComputers(fake.host);
      await k.w.owner.ok("computers.provision", { agentId: k.agentId });
      await open(k.me, k.s, agentPage);
      await page.getByTestId("terminals-head").waitFor({ timeout: 30_000 });
      await page
        .getByTestId("row-older-desktop")
        .waitFor({ timeout: 20_000 })
        .catch(async (e: unknown) => {
          throw new Error(
            `no older-desktop row: ${(await page.getByTestId("work-list").innerText()).replace(/\s+/g, " ")} ${String(e).slice(0, 80)}`,
          );
        });
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      assert.doesNotMatch(body, /Open its desktop/);
      assert.match(body, /Older desktop.*Remove its older desktop.*In Console > Computers/);
      await shoot(page, DIR, "older-desktop");
      const before = page.url();
      await page.getByTestId("row-older-desktop").click();
      // it goes to the Console, to that computer: never to the agent page it was pressed on
      await page.waitForFunction((u) => location.href !== u, before, { timeout: 15_000 });
      assert.doesNotMatch(page.url(), /agent-page/, "the control did not reopen the same agent page");
      await shoot(page, DIR, "older-desktop-in-console");

      // ---- 5 a server that cannot run computers (and so no browser either: the Space browser is not there)
      bindComputers(null);
      bindSpaceBrowser(null);
      bindWorkspaceStatus(async () => {
        throw Object.assign(new Error("No computer for workspaces answers."), { workspace: true });
      });
      await open(k.me, k.s, agentPage);
      await page.getByTestId("terminals-head").waitFor({ timeout: 30_000 });
      await page.getByTestId("terminal-note").waitFor({ timeout: 20_000 });
      assert.equal(
        (await page.getByTestId("terminal-note").innerText()).trim(),
        "No computer is set up for agents yet. An admin of this Space can add one in Console > Computers.",
      );
      assert.match(await page.getByTestId("terminals-head").innerText(), /Not running/);
      await shoot(page, DIR, "no-computer");
      await page.setViewportSize(SIZES.phone);
      await open(k.me, k.s, agentPage);
      await page.getByText("More", { exact: true }).first().click();
      await page.getByText("Computer", { exact: true }).last().click();
      await page.getByTestId("terminal-note").waitFor({ timeout: 20_000 });
      await shoot(page, DIR, "no-computer-phone");
    } finally {
      bindComputers(null);
      await k.close();
    }
  },
);
