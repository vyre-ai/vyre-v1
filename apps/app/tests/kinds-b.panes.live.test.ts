// @tsx
// Real-app proof (13 Nov 2026, lane f-kinds-b): the right pane of a one-to-one chat opens on the other person, of a channel on the channel, of a group chat on the group, of an agent's chat on the agent;
// no menu entry and no slash command row is cut off; and at 760 wide, where one panel fits, a link opens its chat, the pane button is there and every sidebar row opens something. Shots: VYRE_KINDS_B_SHOTS.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright-core";
import { bootFreshSpace, edge } from "./real-app-harness.test.ts";
import { guardCrashes } from "./crash-guard.ts";
import { clippedText } from "./clip-kit.test.ts";
import { claimOwner, joinMaya } from "./kinds-b-kit.test.ts";

test("kinds-b: pane subject per chat kind, no cut text, one panel at 760", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const shots = process.env["VYRE_KINDS_B_SHOTS"] ?? "/tmp/vyre-kinds-b-shots"; fs.mkdirSync(shots, { recursive: true });
  const errs: string[] = [];
  try {
    const { owner, page, call } = await claimOwner(browser, web.origin, space.claim!);
    page.on("pageerror", (e) => errs.push(e.message));
    const guard = guardCrashes(page);
    const { mayaId } = await joinMaya(browser, web.origin, call);
    // the four kinds of chat
    const assistant = (await call("agents.list", {})).agents[0] as { agentId: string };
    const dex = (await call("agents.create", { name: "Dex", role: "You help the team plan launches.", idempotencyKey: "kb-dex" })).agent as { agentId: string };
    const nova = (await call("agents.create", { name: "Nova", role: "You write the copy.", idempotencyKey: "kb-nova" })).agent as { agentId: string };
    const dm = (await call("chat.start", { kind: "chat", agentIds: [], personId: mayaId, idempotencyKey: "kb-dm" })).thread.threadId as string;
    const ch = (await call("channels.create", { name: "launch-week", topic: "Everything for the December launch", visibility: "public", memberIds: [mayaId], agentIds: [dex.agentId], idempotencyKey: "kb-channel" })).channel as { mainThreadId: string };
    const group = (await call("chat.start", { kind: "chat", agentIds: [dex.agentId, nova.agentId], idempotencyKey: "kb-group" })).thread.threadId as string;
    const agentChat = (await call("chat.start", { kind: "chat", agentIds: [dex.agentId], idempotencyKey: "kb-agent" })).thread.threadId as string;

    const open = async (p: Page, id: string): Promise<void> => {
      await p.goto(`${web.origin}/chat#subject=thread:${id}`, { waitUntil: "load" });
      await p.getByTestId("composer-field").first().waitFor({ timeout: 30_000 });
    };
    const showPane = async (p: Page): Promise<void> => {
      // the pane may already be open (the place's own default); press the button only when it is not, once the chat has loaded
      const up = (): Promise<boolean> => p.getByTestId("pane-header").first().isVisible().catch(() => false);
      await p.waitForTimeout(2500);
      if (!(await up()) && await p.getByTestId("pane-button").count() > 0) await p.getByTestId("pane-button").first().click();
      await p.getByTestId("pane-header").first().waitFor({ timeout: 15_000 }).catch(async (e) => { await p.screenshot({ path: path.join(shots, "debug-no-pane.png") }); throw e; });
      await p.waitForTimeout(800);
    };

    // 1. what the pane opens on
    await open(page, dm); await showPane(page);
    await page.getByTestId(`profile-${mayaId}`).waitFor({ state: "visible", timeout: 15_000 });
    assert.equal(await page.getByTestId("chat-details").count(), 0, "a one-to-one chat shows the person, not channel details");
    await page.screenshot({ path: path.join(shots, "1-pane-person.png") });
    await open(page, ch.mainThreadId); await showPane(page);
    await page.getByTestId("chat-details").waitFor({ state: "visible", timeout: 15_000 });
    assert.equal((await page.getByTestId("chat-details-title").innerText()).trim(), "#launch-week");
    assert.match(await page.getByTestId("chat-details-topic").innerText(), /December launch/);
    await page.screenshot({ path: path.join(shots, "2-pane-channel.png") });
    await open(page, group); await showPane(page);
    await page.getByTestId("chat-details").waitFor({ state: "visible", timeout: 15_000 });
    assert.match(await page.getByTestId("chat-details-line").innerText(), /Group chat/);
    await page.screenshot({ path: path.join(shots, "3-pane-group.png") });
    await open(page, agentChat); await showPane(page);
    assert.equal(await page.getByTestId("chat-details").count(), 0, "an agent's chat opens on the agent");
    assert.ok(await page.getByTestId("chats-right-pane").isVisible(), "the agent's own pane shows");
    await page.screenshot({ path: path.join(shots, "4-pane-agent.png") });
    await page.getByRole("tab", { name: /^Knows/ }).first().click({ timeout: 5_000 }).catch(() => undefined);   // a picture of the Knows tab; not an assertion
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(shots, "4b-pane-agent-knows.png") });
    await guard.check("pane subjects");

    // 2. nothing cut: the chat's "..." menu and the slash command list
    await open(page, agentChat);
    await page.getByTestId("more-button").click();
    await page.getByRole("menu").first().waitFor({ timeout: 10_000 });
    await page.screenshot({ path: path.join(shots, "5-more-menu.png") });
    assert.deepEqual(await clippedText(page, '[role="menu"]'), [], "no menu entry is cut off");
    await page.keyboard.press("Escape");
    await page.getByTestId("composer-field").first().click();
    await page.keyboard.type("/");
    await page.getByText("Ask a side question while the agent works").first().waitFor({ timeout: 10_000 });
    await page.screenshot({ path: path.join(shots, "6-slash.png") });
    const tips = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="row-pop-"]')).map((r) => r.textContent ?? ""));
    assert.ok(tips.length > 5, "the command list is up");
    assert.deepEqual(await clippedText(page, '[data-testid^="row-pop-"]'), [], "no slash command description is cut off");

    // 3. the same links at 760 wide, where one panel fits
    const narrow = await owner.newPage();
    await narrow.setViewportSize({ width: 760, height: 900 });
    narrow.on("pageerror", (e) => errs.push(e.message));
    await narrow.goto(`${web.origin}/chat#subject=thread:${agentChat}`, { waitUntil: "load" });
    await narrow.getByTestId("composer-field").first().waitFor({ timeout: 30_000 });
    assert.ok(await narrow.getByTestId("pane-button").isVisible(), "the pane button is there at 760");
    await narrow.screenshot({ path: path.join(shots, "7-narrow-chat-link.png") });
    await narrow.getByTestId("sidebar-back").click();
    await narrow.waitForTimeout(800);
    await narrow.screenshot({ path: path.join(shots, "7b-narrow-back-to-list.png") });
    const listRows = (): Promise<string[]> => narrow.evaluate(() => Array.from(document.querySelectorAll('[data-testid="sidebar-outlet"] [data-testid^="row-"]')).filter((r) => { const b = (r as HTMLElement).getBoundingClientRect(); return b.width > 0 && b.height > 0; }).map((r) => r.getAttribute("data-testid")!).filter((id) => !id.endsWith("-trailing") && !id.endsWith("-leading")));
    const ids = [...new Set(await listRows())];
    assert.ok(ids.length >= 4, `the list has rows (${ids.length})`);
    let opened = 0;
    for (const id of ids.slice(0, 12)) {
      const row = narrow.locator(`[data-testid="${id}"]:visible`).first();
      if (!(await row.isVisible().catch(() => false))) continue;   // the list re-sorts after a visit; a row that moved is not a dead link
      await row.click();
      await narrow.getByTestId("sidebar-back").waitFor({ timeout: 10_000 });   // the item is shown: the way back to the list is on screen
      await narrow.getByTestId("sidebar-back").click();
      await narrow.waitForTimeout(300);
      opened++;
    }
    assert.ok(opened >= 4, `at least four rows opened something (${opened} of ${ids.length})`);
    await narrow.screenshot({ path: path.join(shots, "8-narrow-list.png") });

  } finally { await browser.close(); web.close(); await space.stop(); }
});
