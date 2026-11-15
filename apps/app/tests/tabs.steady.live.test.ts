// @tsx
// The frame holds still on a tab switch (owner, 15 Nov 2026: "switching tabs ... like blinking"; the model and the measurements: team/v1/TABS-2026-11-15.md).
// In the real app a tab is opened for every place with "+" and the rail, then every tab is switched to, both ways, while every frame is sampled. The walk fails when
// the sidebar column or the page's left edge moves in any frame, when the old view is drawn half faded over the new one, when the tab that was
// pressed is no longer under the pointer, when a tab changes width by being selected, or when "+" then a place leaves an empty "New tab" behind.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";

test("tabs: every switch between places keeps the sidebar, the tab strip and the page where they were", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required");
    t.skip("VYRE_APP_DIST required for production browser evidence");
    return;
  }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  const shots = process.env["VYRE_TABS_SHOTS"] ?? "/tmp/vyre-tabs-shots";
  fs.mkdirSync(shots, { recursive: true });
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const page = await context.newPage();
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
    const ids = await page.evaluate(() =>
      [...document.querySelectorAll("[data-testid]")]
        .map((e) => e.getAttribute("data-testid")!)
        .filter((x) => /^(rail-|tab-|shell-|place-|sidebar-)/.test(x)),
    );
    console.log("IDS " + JSON.stringify([...new Set(ids)]));
    const places = ["chats", "files", "records", "automations", "inbox", "vault", "settings", "console"];
    const opened: string[] = [];
    for (const p of places) {
      const plus = page.getByTestId("tab-strip-plus");
      if (opened.length > 0 && (await plus.count()) > 0) {
        await plus.click();
        await page.waitForTimeout(400);
      }
      const target = page.locator(`[data-testid="rail-${p}"], [data-testid="rail-${p}-selected"]`).first();
      try {
        await target.click({ timeout: 2500 });
      } catch {
        // behind the rail's More
        try {
          await page.getByTestId("rail-isle-more").click({ timeout: 2500 });
          await page.waitForTimeout(300);
          await target.click({ timeout: 2500 });
        } catch (e) {
          console.log(`PLACE ${p}: could not open (${String((e as Error).message).slice(0, 80)})`);
          await page.keyboard.press("Escape");
          continue;
        }
      }
      await page.waitForTimeout(1500);
      opened.push(p);
      await page.screenshot({ path: path.join(shots, `place-${p}.png`) });
    }
    const tabs = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="tab-strip"] [role="tab"]')].map((e) => ({
        id: e.getAttribute("data-testid"),
        text: (e.textContent ?? "").trim().slice(0, 30),
        w: Math.round(e.getBoundingClientRect().width),
        sel: e.getAttribute("aria-selected"),
      })),
    );
    fs.writeFileSync(path.join(shots, "timeline.txt"), "TABS " + JSON.stringify(tabs) + "\n");
    await page.screenshot({ path: path.join(shots, "tabs-strip.png"), clip: { x: 0, y: 0, width: 1440, height: 120 } });
    await page.evaluate(`
      window.__rec = function (ms) {
        return new Promise(function (res) {
          var out = [];
          var t0 = performance.now();
          function q(sel) {
            var e = document.querySelector(sel);
            if (!e) return null;
            var r = e.getBoundingClientRect();
            var cs = getComputedStyle(e);
            return Math.round(r.left) + "," + Math.round(r.width) + ",o" + cs.opacity + (cs.display === "none" ? ",none" : "");
          }
          function f() {
            var sel = document.querySelector('[data-testid="tab-strip"] [role="tab"][aria-selected="true"]');
            var selText = "";
            if (sel) {
              var r = sel.getBoundingClientRect();
              selText = (sel.textContent || "").trim().slice(0, 16) + ":" + Math.round(r.left) + "," + Math.round(r.width);
            }
            var own = Array.prototype.slice
              .call(document.querySelectorAll('[data-testid$="-nav"], [data-testid$="-sidebar"], [data-testid*="console-nav"], [data-testid*="settings-nav"], [data-testid*="vault-side"], [data-testid*="inbox-side"]'))
              .map(function (e) {
                var b = e.getBoundingClientRect();
                return e.getAttribute("data-testid") + ":" + Math.round(b.left) + "," + Math.round(b.width);
              })
              .join("|");
            var stage = document.querySelector('[data-testid="place-stage"]');
            out.push({
              t: Math.round(performance.now() - t0),
              sb: q('[data-testid="place-sidebar"]'),
              body: q('[data-testid="place-body"]'),
              stage: q('[data-testid="place-stage"]'),
              kids: stage ? stage.querySelectorAll("*").length > 3 : false,
              swap: document.querySelectorAll("[data-swap]").length,
              ghost: (function () {
                var c = document.querySelector("[data-swap]");
                return c ? getComputedStyle(c).opacity : "";
              })(),
              loading: document.querySelectorAll("[data-loading]").length,
              own: own,
              sel: selText,
            });
            if (performance.now() - t0 < ms) requestAnimationFrame(f);
            else res(out);
          }
          requestAnimationFrame(f);
        });
      };
    `);
    assert.deepEqual(
      tabs.filter((x) => (x.id ?? "").startsWith("tab-new")),
      [],
      "+ then a place opens it in that tab: no empty New tab is left behind",
    );
    assert.ok(opened.length >= 6, `a tab for each place: ${opened.join(", ")}`);
    const tabEls = page.locator('[data-testid="tab-strip"] [role="tab"]');
    const widths = new Map<string, number>();
    for (const x of tabs) widths.set(x.text, x.w);
    const n = await tabEls.count();
    const order = [...Array(n).keys()];
    const seq = [...order, ...order.slice().reverse()];
    let shot = 0;
    for (const i of seq) {
      const label = ((await tabEls.nth(i).textContent()) ?? "").trim().slice(0, 20);
      const rec = page.evaluate("window.__rec(700)");
      const box = (await tabEls.nth(i).boundingBox())!;
      const px = box.x + box.width / 2;
      await tabEls.nth(i).click();
      // three pictures inside the switch: about 30, 90 and 250 ms after the press
      for (const wait of [30, 60, 160]) {
        await page.waitForTimeout(wait);
        await page.screenshot({
          path: path.join(shots, `switch-${String(++shot).padStart(2, "0")}-${label.replace(/\W+/g, "_")}.png`),
        });
      }
      const frames = (await rec) as Record<string, unknown>[];
      let last = "";
      const lines: string[] = [];
      for (const fr of frames) {
        const { t: at, ...rest } = fr;
        const key = JSON.stringify(rest);
        if (key !== last) lines.push(`  +${at}ms ${key}`);
        last = key;
      }
      const story = `SWITCH to "${label}" (${frames.length} frames, ${lines.length} changes)\n${lines.join("\n")}\n`;
      fs.appendFileSync(path.join(shots, "timeline.txt"), story);
      const first = frames[0]!;
      for (const fr of frames) {
        assert.equal(fr["sb"], first["sb"], `to ${label}: the sidebar column moved or changed width\n${story}`);
        assert.equal(fr["body"], first["body"], `to ${label}: the page's edge moved\n${story}`);
        // while the next view gets ready a still copy of the old one covers it, whole; it is never shown half faded over the new view (that was the ghost)
        assert.ok(
          fr["ghost"] === "" || fr["ghost"] === "1",
          `to ${label}: the old view was drawn half faded over the new one\n${story}`,
        );
      }
      assert.ok(first["sb"] !== null, `to ${label}: every place draws its list in the one sidebar column\n${story}`);
      const after = (await tabEls.nth(i).boundingBox())!;
      assert.ok(
        px >= after.x && px <= after.x + after.width,
        `to ${label}: the tab that was pressed is still under the pointer (pressed at ${Math.round(px)}, now ${Math.round(after.x)} to ${Math.round(after.x + after.width)})`,
      );
      const was = widths.get(label.slice(0, 30)) ?? widths.get(label);
      if (was !== undefined)
        assert.ok(
          Math.abs(after.width - was) <= 1,
          `to ${label}: a tab is the same width selected or not (${was}, then ${Math.round(after.width)})`,
        );
    }
    assert.ok(n >= 2, "at least two tabs to switch between");
  } finally {
    await browser.close();
    await web.close();
    await space.stop();
  }
});
