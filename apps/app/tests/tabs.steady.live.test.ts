// @tsx
// A probe, not a gate: in the real app, open a tab per place and switch between them, sampling every frame where the sidebar, the body and the tab highlight are.
// It prints the timeline of each switch (only the frames where something changed). Used to find what moves when a tab is switched (owner, 15 Nov 2026).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";

test("tabs probe: what moves on a tab switch", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    t.skip("VYRE_APP_DIST required");
    return;
  }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  const shots = process.env["VYRE_TABS_SHOTS"] ?? "/tmp/vyre-tabs-shots";
  fs.mkdirSync(shots, { recursive: true });
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
      [...document.querySelectorAll('[role="tab"]')].map((e) => ({
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
            var sel = document.querySelector('[role="tab"][aria-selected="true"]');
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
    const tabEls = page.locator('[role="tab"]:not([data-testid^="tab-new"])');
    const n = await tabEls.count();
    const order = [...Array(n).keys()];
    const seq = [...order, ...order.slice().reverse()];
    let shot = 0;
    for (const i of seq) {
      const label = ((await tabEls.nth(i).textContent()) ?? "").trim().slice(0, 20);
      const rec = page.evaluate("window.__rec(700)");
      await tabEls.nth(i).click();
      // three pictures inside the switch: about 30, 90 and 250 ms after the press
      for (const wait of [30, 60, 160]) {
        await page.waitForTimeout(wait);
        await page.screenshot({ path: path.join(shots, `switch-${String(++shot).padStart(2, "0")}-${label.replace(/\W+/g, "_")}.png`) });
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
      fs.appendFileSync(path.join(shots, "timeline.txt"), `SWITCH to "${label}" (${frames.length} frames, ${lines.length} changes)\n${lines.join("\n")}\n`);
    }
    assert.ok(n >= 2, "at least two tabs to switch between");
  } finally {
    await browser.close();
    await web.close();
    await space.stop();
  }
});
