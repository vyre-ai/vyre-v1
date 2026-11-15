// @tsx
// What opens where (owner, 15 Nov 2026: "What opens as a new tab, how they switch and what opens in the right pane"; the model is D1 to D8 in team/v1/TABS-2026-11-15.md, the rule is
// apps/app/src/shell/tabs/open-rule.ts). In the real app, one thing of each kind is pressed by pointer, by Cmd-press, by the middle button and by its row menu, and the walk asserts where
// it opened: a plain press shows it in the tab on screen; Cmd-press, middle-press and "Open in new tab" open a tab beside it and show it; Shift with Cmd opens it behind; a thing already open
// is shown, not opened twice. Every row measured is written to open-table.txt in the pictures folder.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";

type Pg = import("playwright-core").Page;
interface TabRow {
  id: string;
  sel: boolean;
  name: string;
}

test("tabs: a press opens where the model says, by pointer, Cmd-press, the middle button and the menu", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required");
    t.skip("VYRE_APP_DIST required for production browser evidence");
    return;
  }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  const shots = process.env["VYRE_TABS_SHOTS"] ?? "/tmp/vyre-tabs-open";
  fs.mkdirSync(shots, { recursive: true });
  const table = path.join(shots, "open-table.txt");
  fs.writeFileSync(table, "");
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page: Pg = await context.newPage();
  const failures: string[] = [];
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Tab Owner");
    await page.getByTestId("claim-username").fill("tabowner");
    await page.getByTestId("claim-password").fill("fixture password 123");
    await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click();
    await page.getByTestId("claim-create").click();
    await dismissOnboarding(page, { wait: 60_000 });
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string,
    );
    let n = 0;
    const api = async (cap: string, data: unknown): Promise<any> => {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await context.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, {
        headers: { authorization: `Bearer ${token}` },
        data: { idempotencyKey: `to-${cap}-${++n}`, ...(data as object) },
      });
      assert.equal(r.status(), 200, `${cap}: ${await r.text()}`);
      return (await r.json()).data;
    };
    const ch = (await api("channels.create", { name: "Plans", visibility: "public", memberIds: [], agentIds: [] }))
      .channel as { channelId: string; mainThreadId: string };
    await api("channels.create", { name: "Launch", visibility: "public", memberIds: [], agentIds: [] });
    const root = JSON.stringify(await api("files.tree", {})).match(/"(fld_[a-z0-9]+)"/)![1]!;
    const folder = (await api("files.folder.create", { parentId: root, name: "Contracts" })).folder.folderId as string;
    const fileId = JSON.stringify(
      await api("files.create", { folderId: folder, name: "Letter.md", content: { text: "Dear client" } }),
    ).match(/"(fil_[a-z0-9]+)"/)![1]!;
    const recordId = JSON.stringify(
      await api("records.create", { type: "contact", fields: { name: "Ada Lovelace" } }),
    ).match(/(rec_[a-z0-9]+)/)![1]!;
    await api("automations.create", { name: "Welcome new leads" });
    await api("automations.create", { name: "Intake review" });
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });

    const strip = (): Promise<TabRow[]> =>
      page.evaluate(() =>
        [...(document.querySelector('[data-testid="tab-strip"]')?.querySelectorAll('[role="tab"]') ?? [])].map((e) => ({
          id: (e.getAttribute("data-testid") ?? "").replace(/-selected$/, "").replace(/^tab-/, ""),
          sel: e.getAttribute("aria-selected") === "true",
          name: e.getAttribute("aria-label") ?? "",
        })),
      );
    const place = async (p: string): Promise<void> => {
      const target = page.locator(`[data-testid="rail-${p}"], [data-testid="rail-${p}-selected"]`).first();
      try {
        await target.click({ timeout: 2500 });
      } catch {
        await page.getByTestId("rail-isle-more").click({ timeout: 2500 });
        await page.waitForTimeout(300);
        await target.click({ timeout: 2500 });
      }
      await page.waitForTimeout(1800);
    };
    /** Close every tab but the places' own tabs, so each row starts from the same strip. */
    const tidy = async (): Promise<void> => {
      for (let i = 0; i < 12; i++) {
        const tabs = await strip();
        const extra = tabs.find((x) => x.id.includes(":") || x.id.startsWith("new:"));
        if (extra === undefined) return;
        const tabEl = page.locator(`[data-testid="tab-${extra.id}"], [data-testid="tab-${extra.id}-selected"]`).first();
        await tabEl.hover();
        await page.getByTestId(`tab-close-${extra.id}`).click({ timeout: 3000 });
        await page.waitForTimeout(250);
      }
    };
    const say = (m: string): void => console.log(`[walk ${new Date().toISOString().slice(14, 23)}] ${m}`);
    type How = "plain" | "cmd" | "middle" | "menu" | "cmdshift";
    type Expect = "here" | "tab" | "behind" | "same";
    const rows: string[] = [];
    /** Press `loc` as `how`; assert where it opened; write the row. `menuText` is the row menu's item. */
    const press = async (
      kind: string,
      how: How,
      loc: () => import("playwright-core").Locator,
      expected: Expect,
      o: { menuText?: RegExp; dbl?: boolean; key?: string; after?: RegExp; keep?: boolean } = {},
    ): Promise<void> => {
      const before = await strip();
      const bi = before.findIndex((x) => x.sel);
      const el = loc().first();
      await el.waitFor({ timeout: 15_000 });
      if (how === "plain") await (o.dbl ? el.dblclick() : el.click());
      else if (how === "cmd") await el.click({ modifiers: ["Meta"] });
      else if (how === "cmdshift") await el.click({ modifiers: ["Meta", "Shift"] });
      else if (how === "middle") await el.click({ button: "middle" });
      else if (how === "menu") {
        await el.click({ button: "right" });
        await page.getByRole("menuitem", { name: o.menuText! }).first().click({ timeout: 5000 });
      }
      if (o.key !== undefined) await page.keyboard.press(o.key);
      await page.waitForTimeout(1100);
      const after = await strip();
      const ai = after.findIndex((x) => x.sel);
      const grew = after.length - before.length;
      let got: string;
      if (grew === 0 && ai === bi) got = "here";
      else if (grew === 0) got = "same";
      else if (grew === 1 && ai === bi + 1) got = "tab";
      else if (grew === 1 && ai === bi) got = "behind";
      else got = `odd(${before.length}->${after.length}, ${bi}->${ai})`;
      const line = `${kind.padEnd(34)} ${how.padEnd(8)} expected ${expected.padEnd(7)} got ${got.padEnd(8)} tab now: ${after[ai]?.name ?? "?"}`;
      rows.push(line);
      fs.appendFileSync(table, line + "\n");
      say(line);
      if (got !== expected) {
        failures.push(line);
        const detail = `    before ${before.map((x) => (x.sel ? "[" + x.id + "]" : x.id)).join(" | ")}\n    after  ${after.map((x) => (x.sel ? "[" + x.id + "]" : x.id)).join(" | ")}`;
        fs.appendFileSync(table, detail + "\n");
        say(detail);
      }
      if (o.after !== undefined) assert.match(after[ai]?.id ?? "", o.after, `${kind}/${how}: the tab that opened`);
      if (o.keep !== true) await tidy();
    };

    // ---- Chats: a channel, an agent, a task row ----
    await place("chats");
    const channelRow = (): import("playwright-core").Locator => page.getByTestId(`row-ch:${ch.channelId}`);
    const launchRow = (): import("playwright-core").Locator =>
      page.locator('[data-testid^="row-ch:chn_"]').filter({ hasText: "Launch" });
    await press("chat channel (Chats row)", "plain", channelRow, "here");
    await press("chat channel (Chats row)", "cmd", launchRow, "tab");
    await press("chat channel (Chats row)", "middle", launchRow, "tab");
    await press("chat channel (Chats row)", "menu", launchRow, "tab", { menuText: /open in a new tab/i });
    await press("chat channel (Chats row)", "cmdshift", launchRow, "behind");
    await place("chats");
    await press("agent (Chats row)", "cmd", () => page.locator('[data-testid^="row-f:agt_"]'), "tab");
    await place("chats");
    await press("agent (Chats row)", "plain", () => page.locator('[data-testid^="row-f:agt_"]'), "here");

    // ---- Files: a folder and a file in the list ----
    await place("files");
    await page.getByTestId("row-folder-all").click();
    await page.waitForTimeout(800);
    const folderLine = (): import("playwright-core").Locator => page.getByText("Contracts", { exact: true }).last();
    await press("folder (Files list)", "menu", folderLine, "tab", { menuText: /open in new tab/i });
    await press("folder (Files list)", "plain", folderLine, "here", { dbl: true });
    const fileLine = (): import("playwright-core").Locator => page.getByText("Letter.md", { exact: true }).last();
    await press("file (Files list)", "menu", fileLine, "tab", { menuText: /open in new tab/i });
    await press("file (Files list)", "plain", fileLine, "here", { dbl: true });

    // ---- Records: a type row ----
    await place("records");
    await press("record type (Records row)", "plain", () => page.getByTestId("row-nav:type:agent"), "here");
    await press("record type (Records row)", "cmd", () => page.getByTestId("row-nav:type:contact"), "tab");
    await press("record type (Records row)", "middle", () => page.getByTestId("row-nav:type:contact"), "tab");

    // ---- Automations ----
    await place("automations");
    await press("Automation (list row)", "plain", () => page.getByText("Welcome new leads", { exact: true }), "here");
    await press("Automation (list row)", "cmd", () => page.getByText("Intake review", { exact: true }), "tab");

    // ---- Console, Settings, Vault, Inbox ----
    await place("console");
    await press("Console page (row)", "plain", () => page.getByTestId("row-nav-access"), "here");
    await press("Console page (row)", "cmd", () => page.getByTestId("row-nav-agents"), "tab");
    await place("settings");
    await press("Settings page (row)", "plain", () => page.getByTestId("row-page-ai"), "here");
    await press("Settings page (row)", "cmd", () => page.getByTestId("row-page-notifications"), "tab");
    await place("vault");
    await press("Vault section (row)", "plain", () => page.getByTestId("row-nav-keys"), "here");
    await place("inbox");
    await press("Inbox list (row)", "plain", () => page.getByTestId("row-nav:view:thread"), "here");

    // ---- links to things inside a message: the right pane beside the chat (D3, D4) ----
    {
      const me = JSON.stringify(await api("identity.whoami", {})).match(/usr_[a-z0-9]+/)![0];
      const task = await api("tasks.create", {
        kind: "review",
        title: "Check the plans",
        assigned: { kind: "person", id: me },
      });
      const taskId = JSON.stringify(task).match(/tsk_[a-z0-9]+/)![0];
      const launch = (await api("channels.list", {})).channels.find((c: { name: string }) => c.name === "Launch") as {
        mainThreadId: string;
      };
      await api("chat.post", {
        threadId: launch.mainThreadId,
        body: "See [[Letter.md]] and [[Ada Lovelace]] and [[Check the plans]]",
        blocks: [
          {
            type: "refs",
            v: 1,
            data: {
              refs: [
                { kind: "file", id: fileId, title: "Letter.md" },
                { kind: "record", id: recordId, title: "Ada Lovelace" },
                { kind: "task", id: taskId, title: "Check the plans" },
              ],
            },
          },
        ],
      });
      await place("chats");
      await launchRow().first().click();
      await page.waitForTimeout(2500);
      const seen = async (id: string): Promise<boolean> => (await page.getByTestId(id).count()) > 0;
      const note = (line: string): void => {
        fs.appendFileSync(table, line + "\n");
        say(line);
      };
      const tabsNow = async (): Promise<number> => (await strip()).length;
      const b0 = await tabsNow();
      await page.screenshot({ path: path.join(shots, "links-before.png") });
      fs.writeFileSync(
        path.join(shots, "links-feed.txt"),
        await page
          .getByTestId("conversation-feed")
          .innerText()
          .catch(() => "no feed"),
      );
      await page.getByTestId(`link-${fileId}`).first().click();
      await page.waitForTimeout(1800);
      const fileInPane = await seen("chats-thing-pane");
      note(
        `${"file link in a message".padEnd(34)} ${"plain".padEnd(8)} expected pane    got ${fileInPane && (await tabsNow()) === b0 ? "pane" : "NOT the pane"}`,
      );
      if (!fileInPane || (await tabsNow()) !== b0) failures.push("file link in a message did not open the pane");
      await page.screenshot({ path: path.join(shots, "link-file-pane.png") });
      // a second thing replaces the first; Back in the pane returns to it
      await page.getByTestId(`link-${recordId}`).first().click();
      await page.waitForTimeout(1800);
      const backShown = await seen("thing-pane-back");
      note(
        `${"record link (a second thing)".padEnd(34)} ${"plain".padEnd(8)} expected pane+Back got ${backShown ? "pane+Back" : "no Back"}`,
      );
      if (!backShown) failures.push("a second thing in the pane has no Back");
      await page.screenshot({ path: path.join(shots, "link-record-pane.png") });
      await page.getByTestId("thing-pane-back").click();
      const firstAgain = await page
        .getByTestId("chats-thing-pane")
        .getByText("Dear client")
        .first()
        .waitFor({ timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      note(
        `${"Back in the pane".padEnd(34)} ${"plain".padEnd(8)} expected the file got ${firstAgain ? "the file" : "something else"}`,
      );
      if (!firstAgain) failures.push("Back in the pane did not return to the first thing");
      // Open as a tab: a tab beside this one, shown, the pane closes
      const before = await strip();
      await page.getByTestId("thing-pane-open-tab").click();
      await page.waitForTimeout(1500);
      const after = await strip();
      const bi = before.findIndex((x) => x.sel);
      const ai = after.findIndex((x) => x.sel);
      // the file is already open in the Files tab from the rows above: Open as a tab then shows that tab (a thing open twice is never made); otherwise a new tab beside this one
      const opened =
        (after.length === before.length + 1 && ai === bi + 1) ||
        (after.length === before.length && after[ai]?.name === "Letter.md");
      note(
        `${"Open as a tab (pane head)".padEnd(34)} ${"plain".padEnd(8)} expected tab     got ${opened ? "tab" : `odd(${before.length}->${after.length}, ${bi}->${ai})`}`,
      );
      if (!opened) failures.push("Open as a tab did not open a tab beside this one");
      await tidy();
      await place("chats");
      await launchRow().first().click();
      await page.waitForTimeout(1800);
      // a task opens beside the chat too
      await page.getByTestId(`link-${taskId}`).first().click();
      await page.waitForTimeout(1500);
      const taskPane = await seen("chats-task-pane");
      note(
        `${"task link in a message".padEnd(34)} ${"plain".padEnd(8)} expected pane    got ${taskPane && (await tabsNow()) === b0 ? "pane" : "NOT the pane"}`,
      );
      if (!taskPane) failures.push("task link in a message did not open the pane");
      await page.screenshot({ path: path.join(shots, "link-task-pane.png") });
    }

    // ---- the search (Cmd-K) ----
    await place("chats");
    const search = async (how: "plain" | "cmd"): Promise<void> => {
      await page.keyboard.press("Control+k");
      await page.waitForTimeout(500);
      await page.keyboard.type("Launch");
      await page.waitForTimeout(1200);
    };
    await search("plain");
    const before = await strip();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);
    const after = await strip();
    const lineA = `${"channel (Cmd-K result)".padEnd(34)} ${"Enter".padEnd(8)} expected here    got ${after.length === before.length ? "here" : `grew ${after.length - before.length}`}`;
    rows.push(lineA);
    fs.appendFileSync(table, lineA + "\n");
    if (after.length !== before.length) failures.push(lineA);
    await tidy();
    await search("cmd");
    const before2 = await strip();
    await page.keyboard.press("Control+Enter");
    await page.waitForTimeout(1200);
    const after2 = await strip();
    const lineB = `${"channel (Cmd-K result)".padEnd(34)} ${"Cmd-Enter".padEnd(8)} expected tab     got ${after2.length === before2.length + 1 ? "tab" : `grew ${after2.length - before2.length}`}`;
    rows.push(lineB);
    fs.appendFileSync(table, lineB + "\n");
    if (after2.length !== before2.length + 1) failures.push(lineB);
    await tidy();

    // ---- a thing already open is shown, not opened twice ----
    await place("chats");
    await press("channel (Plans) opened in a tab", "cmd", channelRow, "tab", { keep: true });
    await place("chats");
    {
      const b = await strip();
      await page.getByTestId("tab-strip").first().waitFor();
      await page
        .getByTestId(`row-ch:${ch.channelId}`)
        .first()
        .click({ modifiers: ["Meta"] });
      await page.waitForTimeout(1000);
      const a = await strip();
      const line = `${"channel already open".padEnd(34)} ${"cmd".padEnd(8)} expected same    got ${a.length === b.length ? "same" : `grew ${a.length - b.length}`}`;
      fs.appendFileSync(table, line + "\n");
      say(line);
      if (a.length !== b.length) failures.push(line);
      await tidy();
    }
    await page.screenshot({ path: path.join(shots, "open-done.png") });
    assert.deepEqual(failures, [], `where things opened differs from the model:\n${failures.join("\n")}`);
  } finally {
    await browser.close();
    await web.close();
    await space.stop();
  }
});
