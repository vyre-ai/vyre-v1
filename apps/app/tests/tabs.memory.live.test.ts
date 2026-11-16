// @tsx
// Back puts the page where it was (owner, 14 Nov 2026: "going back ... feel really native"; NAV-2026-11-14 rules 1, 5 and 7; the build is apps/app/src/shell/tabs/view-memory.ts). In the real app:
// a long chat is scrolled, another thing is opened in the same tab, and Back returns to the chat at the same message; a tab is left and returned to with the page, the list and the right pane
// (and its tab) as they were; opening and closing the pane never moves the page.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";

test("tabs: Back and a returned-to tab restore the scroll of the page and the list, and the pane on its tab", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required");
    t.skip("VYRE_APP_DIST required for production browser evidence");
    return;
  }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  const shots = process.env["VYRE_TABS_SHOTS"] ?? "/tmp/vyre-tabs-memory";
  fs.mkdirSync(shots, { recursive: true });
  const log = path.join(shots, "memory.txt");
  fs.writeFileSync(log, "");
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const page = await context.newPage();
  const say = (m: string): void => {
    fs.appendFileSync(log, m + "\n");
    console.log(`[walk ${new Date().toISOString().slice(14, 23)}] ${m}`);
  };
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Mem Owner");
    await page.getByTestId("claim-username").fill("memowner");
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
        data: { idempotencyKey: `tm-${cap}-${++n}`, ...(data as object) },
      });
      assert.equal(r.status(), 200, `${cap}: ${await r.text()}`);
      return (await r.json()).data;
    };
    const plans = (await api("channels.create", { name: "Plans", visibility: "public", memberIds: [], agentIds: [] }))
      .channel as { channelId: string; mainThreadId: string };
    for (let i = 1; i <= 70; i++)
      await api("chat.post", {
        threadId: plans.mainThreadId,
        body: `Message ${i}: the plan for item ${1000 + i} came back and the total reads two thousand five hundred; please confirm before Thursday.`,
      });
    // a long list in the sidebar too
    for (let i = 1; i <= 24; i++)
      await api("channels.create", {
        name: `Room ${String(i).padStart(2, "0")}`,
        visibility: "public",
        memberIds: [],
        agentIds: [],
      });
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    await page.getByTestId("rail-files").click();
    await page.waitForTimeout(1500);
    await page.getByTestId("rail-chats").click();
    await page.waitForTimeout(1500);
    await page.getByTestId(`row-ch:${plans.channelId}`).click();
    const feed = page.getByTestId("conversation-feed");
    await feed.waitFor({ timeout: 30_000 });
    await page.waitForTimeout(2500);

    const top = (): Promise<{ y: number; first: string; off: number }> =>
      page.evaluate(() => {
        const f = document.querySelector('[data-testid="conversation-feed"]') as HTMLElement;
        const box = f.getBoundingClientRect();
        // the first message whose top edge is inside the feed
        const all = [...f.querySelectorAll("*")].filter(
          (e) => /^Message \d+:/.test((e.textContent ?? "").trim()) && e.children.length === 0,
        );
        const at = all.find((e) => e.getBoundingClientRect().bottom > box.top + 4);
        return {
          y: Math.round(f.scrollTop),
          first: (at?.textContent ?? "").slice(0, 12),
          off: Math.round((at?.getBoundingClientRect().top ?? 0) - box.top),
        };
      });
    const box = (await feed.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -1400);
    await page.waitForTimeout(700);
    const start = await top();
    say(`chat scrolled up by hand: scrollTop ${start.y}, first message ${start.first}`);
    assert.ok(start.y > 100 && /Message \d+/.test(start.first), "the long chat is scrolled away from its end");
    await page.screenshot({ path: path.join(shots, "1-chat-scrolled.png") });

    // (a) another thing is opened in this tab (a step), then Back
    await page
      .getByTestId("rail-chats")
      .click()
      .catch(() => undefined);
    await page.locator('[data-testid^="row-f:agt_"]').first().click();
    await page.waitForTimeout(2200);
    const away = await page.getByTestId("conversation-feed").count();
    say(`another chat opened in this tab (feed present: ${away})`);
    await page.getByTestId("nav-back").click();
    await page.waitForTimeout(2500);
    const back = await top();
    say(`Back: scrollTop ${back.y}, first message ${back.first}`);
    await page.screenshot({ path: path.join(shots, "2-after-back.png") });
    assert.equal(back.first, start.first, "Back returns to the same message");
    assert.ok(
      Math.abs(back.off - start.off) <= 4,
      `Back returns to the same place on screen (${start.off}, now ${back.off})`,
    );

    // (b) leave the tab for another and come back
    await page.getByTestId("tab-strip").first().getByTestId("tab-files").click();
    await page.waitForTimeout(1500);
    await page.locator('[data-testid="tab-strip"] [role="tab"]').first().click();
    await page.waitForTimeout(2500);
    const again = await top();
    say(`tab left and returned to: scrollTop ${again.y}, first message ${again.first}`);
    assert.equal(again.first, start.first, "the tab comes back at the same message");
    assert.ok(Math.abs(again.off - start.off) <= 4, `and at the same place on screen (${start.off}, now ${again.off})`);

    // (c) the pane opens on Files; leave the tab and come back: still on Files
    await page.getByTestId("pane-button").first().click();
    await page.waitForTimeout(1200);
    const paneStrip = page.getByTestId("tab-strip").nth(1);
    await paneStrip.getByTestId("tab-files").click();
    await page.waitForTimeout(800);
    const during = await top();
    say(`the pane opened on Files: page scrollTop ${during.y} (was ${start.y})`);
    assert.ok(
      Math.abs(during.off - start.off) <= 4 && during.first === start.first,
      "opening the pane did not move the page",
    );
    await page.screenshot({ path: path.join(shots, "3-pane-on-files.png") });
    await page.getByTestId("tab-strip").first().getByTestId("tab-files").click();
    await page.waitForTimeout(1200);
    await page.locator('[data-testid="tab-strip"] [role="tab"]').first().click();
    await page.waitForTimeout(2500);
    const sel = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="tab-strip"]')]
        .slice(1)
        .flatMap((s) =>
          [...s.querySelectorAll('[role="tab"][aria-selected="true"]')].map((e) => e.getAttribute("aria-label")),
        ),
    );
    say(`tab returned to: pane tabs selected ${JSON.stringify(sel)}, scrollTop ${(await top()).y}`);
    await page.screenshot({ path: path.join(shots, "4-returned-pane.png") });
    assert.ok(sel.includes("Files"), `the pane is on Files again (${JSON.stringify(sel)})`);
    {
      const r = await top();
      assert.ok(r.first === start.first && Math.abs(r.off - start.off) <= 4, "and the page is where it was");
    }
    // closing the pane does not move the page either
    await page.getByTestId("pane-toggle").first().click();
    await page.waitForTimeout(900);
    const closed = await top();
    say(`pane closed: scrollTop ${closed.y}`);
    assert.ok(
      closed.first === start.first && Math.abs(closed.off - start.off) <= 4,
      "closing the pane did not move the page",
    );

    // (d) the sidebar list keeps its place too
    // a short window, so the list scrolls as it is drawn
    await page.setViewportSize({ width: 1440, height: 420 });
    await page.waitForTimeout(800);
    const list = page.getByTestId("sidebar-list");
    const lb = (await list.boundingBox())!;
    await page.mouse.move(lb.x + 100, lb.y + lb.height / 2);
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(600);
    const side = (): Promise<number> =>
      page.evaluate(() => {
        const l = document.querySelector('[data-testid="sidebar-list"]')!;
        const sc = [l, ...l.querySelectorAll("*")].find((e) => e.scrollTop > 0) as HTMLElement | undefined;
        return Math.round(sc?.scrollTop ?? 0);
      });
    say(
      "sidebar scroller: " +
        (await page.evaluate(() => {
          const l = document.querySelector('[data-testid="sidebar-list"]')!;
          const sc = [l, ...l.querySelectorAll("*")].find((e) => e.scrollTop > 0) as HTMLElement | undefined;
          return sc
            ? `${sc.tagName} testid=${sc.getAttribute("data-testid")} parent=${sc.parentElement?.getAttribute("data-testid")}`
            : "none";
        })),
    );
    const sideStart = await side();
    say(`sidebar list scrolled: ${sideStart}`);
    assert.ok(sideStart > 20, "the sidebar list is scrolled");
    await page.getByTestId("tab-strip").first().getByTestId("tab-files").click();
    await page.waitForTimeout(1500);
    await page.locator('[data-testid="tab-strip"] [role="tab"]').first().click();
    await page.waitForTimeout(2500);
    const sideAgain = await side();
    say(`sidebar list after the tab was returned to: ${sideAgain}`);
    await page.screenshot({ path: path.join(shots, "5-sidebar-returned.png") });
    assert.ok(
      Math.abs(sideAgain - sideStart) <= 4,
      `the sidebar list is where it was (${sideStart}, now ${sideAgain})`,
    );
  } finally {
    await page.screenshot({ path: path.join(shots, "end.png") }).catch(() => undefined);
    await browser.close();
    await web.close();
    await space.stop();
  }
});
