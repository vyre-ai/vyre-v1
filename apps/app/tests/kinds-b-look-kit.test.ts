// The after pictures for lane f-kinds-b (13 Nov 2026), in one skin: the person pane, the channel and group details, a wrapped menu entry, a cut row with its tooltip text, and the one-panel flip at 760 wide.
// One skin per file keeps each walk under the 120 s cap. Pictures go to VYRE_KINDS_B_SHOTS as <name>-<skin>.png.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright-core";
import { bootFreshSpace, edge } from "./real-app-harness.test.ts";
import { claimOwner, joinMaya } from "./kinds-b-kit.test.ts";

export function lookWalk(skin: "paper" | "graphite"): void {
  test(`kinds-b look, ${skin}: person, channel and group panes, wrapped menu entry, row tooltip, 760 flip`, async (t) => {
    const dist = process.env["VYRE_APP_DIST"];
    if (!dist) {
      if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required");
      t.skip("VYRE_APP_DIST required");
      return;
    }
    const { chromium } = await import("playwright-core");
    const space = await bootFreshSpace();
    const web = await edge(dist, space.url);
    const browser = await chromium.launch({
      executablePath: process.env["CHROME_BIN"] || chromium.executablePath(),
      args: ["--no-sandbox"],
    });
    const shots = process.env["VYRE_KINDS_B_SHOTS"] ?? "/tmp/vyre-kinds-b-shots";
    fs.mkdirSync(shots, { recursive: true });
    const shot = (p: Page, name: string): Promise<unknown> =>
      p.screenshot({ path: path.join(shots, `${name}-${skin}.png`) });
    try {
      const { owner, page, call } = await claimOwner(browser, web.origin, space.claim!);
      const { mayaId } = await joinMaya(browser, web.origin, call);
      const dex = (
        await call("agents.create", { name: "Dex", role: "You help the team plan launches.", idempotencyKey: "kl-dex" })
      ).agent as { agentId: string };
      const nova = (
        await call("agents.create", { name: "Nova", role: "You write the copy.", idempotencyKey: "kl-nova" })
      ).agent as { agentId: string };
      const dm = (await call("chat.start", { kind: "chat", agentIds: [], personId: mayaId, idempotencyKey: "kl-dm" }))
        .thread.threadId as string;
      const ch = (
        await call("channels.create", {
          name: "launch-week",
          topic: "Everything for the December launch",
          visibility: "public",
          memberIds: [mayaId],
          agentIds: [dex.agentId],
          idempotencyKey: "kl-channel",
        })
      ).channel as { mainThreadId: string };
      const long = (
        await call("channels.create", {
          name: "december-launch-press-kit-and-partner-review-notes",
          visibility: "public",
          memberIds: [],
          agentIds: [],
          idempotencyKey: "kl-long",
        })
      ).channel as { mainThreadId: string };
      const group = (
        await call("chat.start", { kind: "chat", agentIds: [dex.agentId, nova.agentId], idempotencyKey: "kl-group" })
      ).thread.threadId as string;
      await call("threads.set_agent_replies", { threadId: ch.mainThreadId, inThreads: true });
      const url = (id: string): string => `${web.origin}/chat?skin=${skin}#subject=thread:${id}`;
      const open = async (p: Page, id: string): Promise<void> => {
        await p.goto(url(id), { waitUntil: "load" });
        await p.getByTestId("composer-field").first().waitFor({ timeout: 30_000 });
      };
      const showPane = async (p: Page): Promise<void> => {
        await p.waitForTimeout(2500);
        if (
          !(await p
            .getByTestId("pane-header")
            .first()
            .isVisible()
            .catch(() => false)) &&
          (await p.getByTestId("pane-button").count()) > 0
        )
          await p.getByTestId("pane-button").first().click();
        await p.getByTestId("pane-header").first().waitFor({ timeout: 15_000 });
        await p.waitForTimeout(800);
      };
      await open(page, dm);
      await showPane(page);
      await page.getByTestId(`profile-${mayaId}`).waitFor({ timeout: 15_000 });
      await shot(page, "pane-person");
      await open(page, ch.mainThreadId);
      await showPane(page);
      await page.getByTestId("chat-details").waitFor({ timeout: 15_000 });
      await shot(page, "pane-channel");
      // a menu entry that wraps: the switch is on, so its note shows beside it
      await page.getByTestId("more-button").click();
      await page.getByRole("menu").first().waitFor({ timeout: 10_000 });
      await page.waitForTimeout(400);
      await shot(page, "menu-wrapped-entry");
      await page.keyboard.press("Escape");
      await open(page, group);
      await showPane(page);
      await page.getByTestId("chat-details").waitFor({ timeout: 15_000 });
      await shot(page, "pane-group");
      // a row cut with dots gives its whole text as its tooltip when the pointer reaches it
      const row = page.getByText("december-launch-press-kit-and-partner-review-notes", { exact: true }).first();
      await page.mouse.move(700, 500);
      await row.hover({ force: true });
      await page.waitForTimeout(300);
      const tip = await row.evaluate((el) => {
        let n: HTMLElement | null = el as HTMLElement;
        while (n && !n.getAttribute("title")) n = n.parentElement;
        return n?.getAttribute("title") ?? "";
      });
      assert.match(
        tip,
        /december-launch-press-kit-and-partner-review-notes/,
        `a cut row has its full text as its tooltip (got "${tip}")`,
      );
      fs.writeFileSync(
        path.join(shots, `row-tooltip-${skin}.txt`),
        `Hovered the sidebar row of a channel whose name is cut with dots. Its title attribute (the browser's tooltip) reads:\n${tip}\n`,
      );
      await shot(page, "row-cut");
      // the one-panel flip: the list is on screen at 760 wide, then a link to a chat arrives
      const narrow = await owner.newPage();
      await narrow.setViewportSize({ width: 760, height: 900 });
      await narrow.goto(`${web.origin}/chat?skin=${skin}`, { waitUntil: "load" });
      await narrow.getByTestId("sidebar-outlet").locator(":visible").first().waitFor({ timeout: 30_000 });
      await narrow.waitForTimeout(800);
      await shot(narrow, "narrow-before-link");
      await narrow.evaluate((id) => {
        location.hash = `subject=thread:${id}`;
      }, long.mainThreadId);
      await narrow.getByTestId("sidebar-back").waitFor({ timeout: 15_000 });
      await narrow.waitForTimeout(800);
      await shot(narrow, "narrow-after-link");
    } finally {
      await browser.close();
      web.close();
      await space.stop();
    }
  });
}
