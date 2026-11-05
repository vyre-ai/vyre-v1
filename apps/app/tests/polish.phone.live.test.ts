// Phone, polish audit X2: the Console draws (the Console, or the line that it opens on a computer) and never stays on the splash; Settings has one back bar. Real app, 390 wide, light and graphite.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { guardCrashes } from "./crash-guard.ts";

test("phone: the Console draws something at once, and Settings shows one back bar", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required"); return; }
  const { chromium } = await import("playwright-core");
  const space = await bootFreshSpace(), web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: process.env["CHROME_BIN"] || chromium.executablePath(), args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage(); const guard = guardCrashes(page);
  const shots = process.env["POLISH_SHOTS"] ?? "/tmp/polish-shots"; fs.mkdirSync(shots, { recursive: true });
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Olivia Owner"); await page.getByTestId("claim-username").fill("olivia");
    await page.getByTestId("claim-password").fill("fixture password 123"); await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click(); await dismissOnboarding(page);
    await page.getByTestId("shell").or(page.getByTestId("mobile-shell")).first().waitFor({ timeout: 30_000 });
    await guard.check("after claiming");
    for (const skin of ["paper", "graphite"] as const) {
      // 1. the Console, opened by its address on a phone: it draws the line that it opens on a computer (owner ruling, 3 Nov), never the splash
      await page.goto(`${web.origin}/console?skin=${skin}`, { waitUntil: "load" });
      // the launch frame leaves at once: it must not cover the line for its eight-second limit
      await page.getByTestId("first-frame").waitFor({ state: "detached", timeout: 4_000 });
      await page.getByText(/The Console opens on a computer/).waitFor({ timeout: 15_000 });
      await guard.check(`console ${skin}`); await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(shots, `1-console-phone-${skin === "paper" ? "light" : "graphite"}.png`), animations: "disabled" });
      // 2. Settings: the page list, then a page: one back bar each time
      await page.goto(`${web.origin}/settings?skin=${skin}`, { waitUntil: "load" });
      await page.getByTestId("settings-place").waitFor({ timeout: 20_000 });
      await page.getByTestId("page-profile").waitFor({ timeout: 20_000 }); await page.waitForTimeout(400);
      const backs = await page.evaluate(() => [...document.querySelectorAll("[data-testid='back'], [aria-label='Back'], [aria-label^='Back to']")].filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => (e.getAttribute("data-testid") ?? "") + "|" + (e.getAttribute("aria-label") ?? "") + "|" + (e.textContent ?? "").trim().slice(0, 20)));
      await guard.check(`settings ${skin}`);
      await page.screenshot({ path: path.join(shots, `2-settings-phone-${skin === "paper" ? "light" : "graphite"}.png`), animations: "disabled" });
      assert.equal(backs.length, 1, `one back bar on a Settings page at 390 (${JSON.stringify(backs)})`);
    }
  } finally { await context.close(); await browser.close(); web.close(); await space.stop(); }
});
