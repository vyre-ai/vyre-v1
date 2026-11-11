// The owner walk's fixes, proven in the real app (lane f-ownerwalk, 12 Nov 2026): each step is something the owner met on his walk and winced at. Real daemon, production export, Chromium.
//   1 Your Profile (the avatar) opens in the Settings tab already open, not a second Settings tab.
//   2 Add a Space opens Add a Space only, never the Add a server dialog behind it.
//   3 A chat whose reply has finished says "Message Assistant…" in its empty composer, not "Steer Assistant…".
//   4 Cmd-K finds Settings and its pages by name, and the Console for the owner.
//   5 New project (Cmd-K) opens Projects with its new row started.
//   6 The agent's Computer pane draws Browser right under its label: no tall gap, no card over the next label.
import test from "node:test";
import assert from "node:assert/strict";
import { bootWalk, composer, connectAi } from "./ownerwalk-kit.test.ts";

test("owner walk fixes: one Settings tab, Add a Space alone, the composer's words, Cmd-K finds Settings, New project, the Computer pane's layout", async (t) => {
  const w = await bootWalk(t, "polish");
  if (!w) return;
  const { page } = w;
  const tabs = async (): Promise<string[]> => (await page.getByTestId("tab-strip").innerText()).split("\n").map((x) => x.trim()).filter((x) => x !== "" && x !== "×");
  try {
    await connectAi(w);
    const dex = (await w.api("agents.create", { name: "Dex", role: "You help the team plan and ship launches.", idempotencyKey: "pw-dex" })).data.agent.agentId as string;

    await w.step("1 Your Profile opens in the Settings tab already open", async () => {
      await w.go("settings", "settings-place");
      await page.getByTestId("row-page-ai").click();
      await page.getByTestId("page-ai").waitFor({ timeout: 15_000 });
      await page.getByTestId("space-tile").click();
      await page.getByRole("menuitem", { name: "Your Profile", exact: true }).click();
      await page.getByTestId("page-profile").waitFor({ timeout: 15_000 });
      const strip = await tabs();
      assert.equal(strip.filter((x) => x === "Settings").length, 1, `one Settings tab: ${JSON.stringify(strip)}`);
      await w.shot("profile-one-settings-tab", { widths: [1280] });
    });

    await w.step("2 Add a Space opens Add a Space only", async () => {
      await w.go("chat", "chats-place");
      await page.getByTestId("space-tile").click();
      await page.getByRole("menuitem", { name: "Add a Space", exact: true }).click();
      await page.getByText("Join a Space", { exact: true }).waitFor({ timeout: 15_000 });
      await page.keyboard.press("Escape");
      const back = page.getByRole("button", { name: /back/i }).first();
      if (await page.getByText("Join a Space", { exact: true }).count() && await back.count()) await back.click();
      await page.getByTestId("shell").waitFor({ timeout: 15_000 });
      await page.waitForTimeout(800);
      assert.equal(await page.getByText("Add a server", { exact: true }).count(), 0, "no Add a server dialog was opened behind it");
      assert.equal(await page.getByTestId("settings-place").count(), 0, "Settings was not opened behind it");
      await w.shot("add-a-space-closed", { widths: [1280] });
    });

    await w.step("3 the composer of a finished chat says Message, not Steer", async () => {
      await w.go("chat", "chats-place");
      const c = composer(page); await c.waitFor({ timeout: 15_000 });
      await c.fill("LONG plan for the launch week");
      await c.press("Enter");
      // the conversation's field is made while the reply is still being written: it says Steer then
      await page.getByTestId("stop-button").waitFor({ timeout: 20_000 });
      await page.waitForFunction(() => /^Steer /.test(document.querySelector('[data-testid="conversation"] ~ * [data-testid="composer-field"], [data-testid="composer-field"]')?.getAttribute("data-placeholder") ?? ""), null, { timeout: 15_000 });
      await page.getByTestId("stop-button").click();
      await page.getByTestId("stop-button").waitFor({ state: "detached", timeout: 30_000 });
      const field = page.locator('[data-testid="composer-field"]').first();
      await page.waitForFunction(() => document.querySelector('[data-testid="composer-field"]')?.getAttribute("data-placeholder") === "Message Assistant…", null, { timeout: 15_000 })
        .catch(async () => { throw new Error(`the empty composer of a finished chat says "${await field.getAttribute("data-placeholder")}"`); });
      await w.shot("composer-after-reply", { widths: [1280] });
    });

    await w.step("4 Cmd-K finds Settings, a page of it, and the Console", async () => {
      await page.keyboard.press("Control+K");
      await page.getByTestId("cmdk-input").fill("sett");
      await page.getByText("Settings", { exact: true }).first().waitFor({ timeout: 10_000 });
      await w.shot("cmdk-sett", { widths: [1280] });
      await page.getByTestId("cmdk-input").fill("notifications");
      await page.getByText("Notifications", { exact: true }).first().waitFor({ timeout: 10_000 });
      await page.keyboard.press("Enter");
      await page.getByTestId("page-notifications").waitFor({ timeout: 15_000 });
      await page.keyboard.press("Control+K");
      await page.getByTestId("cmdk-input").fill("console");
      await page.getByText("Console", { exact: true }).first().waitFor({ timeout: 10_000 });
      await page.keyboard.press("Enter");
      await page.getByTestId("console").waitFor({ timeout: 20_000 });
    });

    await w.step("5 New project starts a new project row", async () => {
      await w.go("chat", "chats-place");
      await page.keyboard.press("Control+K");
      await page.getByTestId("cmdk-input").fill(">new project");
      await page.getByText("New project", { exact: true }).first().click({ timeout: 10_000 });
      const row = page.getByTestId("records-adding-input");
      await row.waitFor({ timeout: 15_000 });
      assert.match(await row.inputValue(), /^New project$/i, "the new row is a project's");
      await w.shot("new-project-row", { widths: [1280] });
      await row.fill("Spring launch");
      await row.press("Enter");
      await page.getByTestId("project-page").or(page.getByText("Spring launch", { exact: true })).first().waitFor({ timeout: 20_000 });
      const made = (await w.api("projects.list", {})).data;
      assert.ok(JSON.stringify(made).includes("Spring launch"), "a real project was made");
    });

    await w.step("6 the Computer pane: Browser sits under its label", async () => {
      const thread = (await w.api("chat.start", { kind: "chat", agentIds: [dex], title: "Desk work", idempotencyKey: "pw-thread" })).data.thread.threadId as string;
      await page.goto(`${w.web.origin}/chat#subject=thread:${thread}`, { waitUntil: "load" });
      await page.getByTestId("composer-field").waitFor({ timeout: 20_000 });
      if (await page.getByTestId("pane-agent").count() === 0) await page.getByTestId("pane-button").click();
      await page.getByTestId("pane-agent").waitFor({ timeout: 20_000 });
      await page.getByTestId("tab-computer").click();
      const label = page.getByTestId("label-l-browser");
      await label.waitFor({ timeout: 20_000 });
      const next = page.getByTestId("browser-note").or(page.getByTestId("browser-take")).or(page.getByTestId("browser-none")).or(page.getByTestId("browser-open")).first();
      await next.waitFor({ timeout: 20_000 });
      await page.waitForTimeout(1500);
      const a = (await label.boundingBox())!, b = (await next.boundingBox())!;
      const gap = b.y - (a.y + a.height);
      assert.ok(gap >= 0 && gap < 80, `the Browser card starts ${Math.round(gap)} px under its label`);
      await w.shot("computer-pane", { widths: [1280] });
    });
  } finally {
    if (w.failures.length) console.log(`NOTES:\n${w.notes.join("\n")}`);
    await w.stop();
  }
  assert.deepEqual(w.failures, [], `${w.failures.length} step(s) fail`);
});
