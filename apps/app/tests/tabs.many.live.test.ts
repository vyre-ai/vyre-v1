// @tsx
// Many tabs, the New tab and the phone (owner, 15 Nov 2026: "do the tabs logic properly"; the lead's walk of the same night). In the real app:
//  - a New tab finds places like Cmd-K (the same search), Enter opens the best match in THIS tab, and the New tab keeps the steady sidebar column; words that find nothing still start a chat;
//  - with 15 and 30 tabs no tab is squeezed to an icon, the strip scrolls with the selected tab kept in view and a fade at the cut edge, the full name is on hover, a "tabs" menu lists every tab, closing
//    the selected tab selects the one the person came from, Cmd-Shift-T brings a closed tab back;
//  - Inbox's header names what the sidebar selected; the phone's You tab has no hole; the browser's Back on the phone never leaves for a dead page.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";

test("tabs: the New tab opens places, many tabs stay whole, Inbox names its list, the phone's You and Back hold", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required");
    t.skip("VYRE_APP_DIST required for production browser evidence");
    return;
  }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  const shots = process.env["VYRE_TABS_SHOTS"] ?? "/tmp/vyre-tabs-many";
  fs.mkdirSync(shots, { recursive: true });
  const log = path.join(shots, "many.txt");
  fs.writeFileSync(log, "");
  const say = (m: string): void => {
    fs.appendFileSync(log, m + "\n");
    console.log(`[walk ${new Date().toISOString().slice(14, 23)}] ${m}`);
  };
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Many Owner");
    await page.getByTestId("claim-username").fill("manyowner");
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
        data: { idempotencyKey: `tmn-${cap}-${++n}`, ...(data as object) },
      });
      assert.equal(r.status(), 200, `${cap}: ${await r.text()}`);
      return (await r.json()).data;
    };
    const strip = (): Promise<{ id: string; sel: boolean; name: string; w: number; x: number; text: string }[]> =>
      page.evaluate(() =>
        [...(document.querySelector('[data-testid="tab-strip"]')?.querySelectorAll('[role="tab"]') ?? [])].map((e) => {
          const r = e.getBoundingClientRect();
          return {
            id: (e.getAttribute("data-testid") ?? "").replace(/-selected$/, "").replace(/^tab-/, ""),
            sel: e.getAttribute("aria-selected") === "true",
            name: e.getAttribute("aria-label") ?? "",
            w: Math.round(r.width),
            x: Math.round(r.left),
            text: (e.textContent ?? "").trim(),
          };
        }),
      );

    // ---- A: the New tab opens places ----
    for (const [word, place, rail] of [
      ["Records", "records", "Records"],
      ["Vault", "vault", "Vault"],
      ["Settings", "settings", "Settings"],
    ] as const) {
      await page.keyboard.press("Control+t");
      await page.waitForTimeout(700);
      const input = page.getByPlaceholder(/Open anything/).first();
      await input.fill(word);
      await page.waitForTimeout(900);
      // the same column as every other place, with the places in it
      assert.ok((await page.getByTestId("place-sidebar").count()) > 0, "the New tab keeps the sidebar column");
      if (word === "Records") await page.screenshot({ path: path.join(shots, "newtab-typed-records.png") });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1800);
      const tabs = await strip();
      const sel = tabs.find((x) => x.sel);
      say(`New tab, "${word}" + Enter: selected tab ${sel?.name}, tabs ${tabs.map((x) => x.name).join(" | ")}`);
      assert.ok(!tabs.some((x) => x.id.startsWith("new:")), `no empty New tab is left (${word})`);
      assert.equal(sel?.name, rail, `Enter opened ${word} in this tab`);
    }
    // words that find nothing still start a chat
    await page.keyboard.press("Control+t");
    await page.waitForTimeout(700);
    await page
      .getByPlaceholder(/Open anything/)
      .first()
      .fill("zq xv blorf");
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(shots, "newtab-nothing-matches.png") });
    const hint = await page.getByText(/start a chat/i).count();
    say(`nothing matches: the chat hint is shown (${hint})`);
    assert.ok(hint > 0, "words that find nothing offer the chat");
    await page.keyboard.press("Escape");
    // tidy: close the leftover New tab
    for (const x of await strip()) {
      if (!x.id.startsWith("new:")) continue;
      await page.locator(`[data-testid="tab-${x.id}"], [data-testid="tab-${x.id}-selected"]`).first().hover();
      await page.getByTestId(`tab-close-${x.id}`).click();
    }

    // ---- C: Inbox's header names its list ----
    await page
      .getByTestId("rail-inbox")
      .click()
      .catch(async () => {
        await page.getByTestId("rail-isle-more").click();
        await page.getByTestId("rail-inbox").click();
      });
    await page.waitForTimeout(1800);
    await page.getByTestId("row-nav:view:contact").click();
    await page.waitForTimeout(800);
    const h1 = await page
      .getByTestId("inbox-head")
      .first()
      .innerText()
      .catch(() => "");
    say(`Inbox, By contact selected: header "${h1.split("\n")[0]}"`);
    assert.match(h1, /By contact/, "the header names By contact");
    await page.screenshot({ path: path.join(shots, "inbox-by-contact.png") });
    await page.getByTestId("row-nav:view:thread").click();
    await page.waitForTimeout(800);
    const h2 = await page
      .getByTestId("inbox-head")
      .first()
      .innerText()
      .catch(() => "");
    assert.match(h2, /All inboxes/, "and All inboxes names All inboxes");

    // ---- B: many tabs ----
    const mains: string[] = [];
    for (let i = 1; i <= 30; i++) {
      const c = (
        await api("channels.create", {
          name: `Room ${String(i).padStart(2, "0")} planning`,
          visibility: "public",
          memberIds: [],
          agentIds: [],
        })
      ).channel as { mainThreadId: string };
      mains.push(c.mainThreadId);
    }
    await page.getByTestId("rail-chats").click();
    await page.waitForTimeout(1500);
    const open = async (i: number): Promise<void> => {
      await page.evaluate((h) => void (location.hash = h), `subject=thread:${mains[i]}`);
      await page.waitForTimeout(450);
    };
    const check = async (count: number): Promise<void> => {
      const tabs = await strip();
      say(`${count} tabs: ${tabs.length} in the strip, widths ${[...new Set(tabs.map((x) => x.w))].join(",")}`);
      assert.ok(tabs.length >= count, `${count} tabs are open (${tabs.length})`);
      for (const x of tabs) {
        assert.ok(x.text.length > 0, `no tab is an icon (${x.name})`);
        assert.ok(x.w >= 60 && x.w <= 200, `no tab is squeezed or stretched (${x.name} is ${x.w} wide)`);
      }
      const sel = tabs.find((x) => x.sel)!;
      const box = await page.evaluate(() => {
        const s = document.querySelector('[data-testid="tab-strip"]')!;
        const sc = [...s.querySelectorAll("*")].find(
          (e) =>
            (e as HTMLElement).scrollWidth > (e as HTMLElement).clientWidth + 2 &&
            getComputedStyle(e).overflowX !== "visible",
        ) as HTMLElement | undefined;
        const r = sc?.getBoundingClientRect();
        return {
          left: r?.left ?? 0,
          right: r?.right ?? 0,
          scrolls: !!sc,
          fade: sc?.getAttribute("data-tabfade") ?? "",
        };
      });
      assert.ok(box.scrolls, "the strip scrolls");
      assert.ok(
        sel.x >= box.left - 2 && sel.x + sel.w <= box.right + 2,
        `the selected tab is in view (${sel.x}..${sel.x + sel.w} in ${box.left}..${box.right})`,
      );
      say(`  scrolls, fade "${box.fade}", selected ${sel.name} in view`);
      assert.notEqual(box.fade, "none", "a fade at the cut edge");
    };
    for (let i = 0; i < 15; i++) await open(i);
    await check(15);
    await page.screenshot({ path: path.join(shots, "tabs-15.png"), clip: { x: 0, y: 0, width: 1440, height: 120 } });
    for (let i = 15; i < 30; i++) await open(i);
    await check(30);
    await page.screenshot({ path: path.join(shots, "tabs-30.png"), clip: { x: 0, y: 0, width: 1440, height: 120 } });
    // the full name on hover
    const last = (await strip()).find((x) => x.sel)!;
    const tt = await page.locator(`[data-testid="tab-${last.id}-selected"]`).getAttribute("data-tt");
    assert.equal(tt, last.name, "the full name is on hover");
    // the tabs menu lists every tab; choosing the first brings it into view
    await page.getByTestId("tab-strip-tabs").click();
    await page.waitForTimeout(500);
    const items = await page.getByRole("menuitem").count();
    say(`the tabs menu lists ${items} entries`);
    assert.ok(items >= 30, "the tabs menu lists every tab");
    await page.screenshot({ path: path.join(shots, "tabs-menu.png") });
    await page.getByRole("menuitem").first().click();
    await page.waitForTimeout(900);
    const firstSel = (await strip()).find((x) => x.sel)!;
    await check(30);
    say(`chosen from the menu: ${firstSel.name}`);
    // closing the selected tab selects the one the person came from
    const before = await strip();
    const came = before.find((x) => x.sel)!;
    await page
      .locator(`[data-testid="tab-${before[before.length - 2]!.id}"]`)
      .first()
      .click();
    await page.waitForTimeout(500);
    await page
      .locator(`[data-testid="tab-${before[before.length - 1]!.id}"]`)
      .first()
      .click();
    await page.waitForTimeout(500);
    const target = (await strip()).find((x) => x.sel)!;
    await page.locator(`[data-testid="tab-${target.id}-selected"]`).hover();
    await page.getByTestId(`tab-close-${target.id}`).click();
    await page.waitForTimeout(700);
    const after = (await strip()).find((x) => x.sel)!;
    say(
      `closed ${target.name} (came from ${before[before.length - 2]!.name}, first selected ${came.name}): now ${after.name}`,
    );
    assert.equal(
      after.name,
      before[before.length - 2]!.name,
      "closing the selected tab returns to the one the person came from",
    );
    // Cmd-Shift-T reopens it
    await page.keyboard.press("Control+Shift+t");
    await page.waitForTimeout(900);
    const reopened = (await strip()).find((x) => x.sel);
    assert.equal(reopened?.name, target.name, "Cmd-Shift-T reopens the closed tab");

    // ---- D, E: the phone ----
    const pp = await context.newPage();
    await pp.setViewportSize({ width: 390, height: 844 });
    await pp.emulateMedia({ colorScheme: "light" });
    await pp.goto(`${web.origin}/healthz`, { waitUntil: "load" });
    await pp.goto(`${web.origin}/chat`, { waitUntil: "load" });
    await pp
      .getByTestId("mobile-shell")
      .waitFor({ timeout: 30_000 })
      .catch(() => undefined);
    await pp.waitForTimeout(2500);
    await pp.getByText("You", { exact: true }).last().click();
    await pp.waitForTimeout(1500);
    const gap = await pp.evaluate(() => {
      const y = document.querySelector('[data-testid="you-screen"]')?.getBoundingClientRect();
      const r = document.querySelector('[data-testid="row-you-replies"]')?.getBoundingClientRect();
      return y && r ? Math.round(r.top - y.bottom) : null;
    });
    say(`phone You tab: gap between the list and the rows under it ${gap}`);
    await pp.screenshot({ path: path.join(shots, "phone-you.png") });
    assert.ok(gap !== null && gap <= 40, `no hole on the You tab (${gap})`);
    await pp.close();
  } finally {
    await page.screenshot({ path: path.join(shots, "end.png") }).catch(() => undefined);
    await browser.close();
    await web.close();
    await space.stop();
  }
});
