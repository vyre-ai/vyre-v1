// The list takes a new Automation the moment it is made (AUTOMATIONS-BUILD-RC29 round five): from an empty Space, Start from an example then Use template, and New automation from the first page, each adds a row at once.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bootFreshSpace, claimOnEdge, dismissOnboarding, edge } from "./real-app-harness.test.ts";

const PASSWORD = "fixture password 123";
const SHOTS = process.env["SHOTS"];

test("production Automations: the list takes a new Automation the moment it is made, from the empty first page", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required");
    t.skip("VYRE_APP_DIST required for production browser evidence");
    return;
  }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  assert.ok(fs.existsSync(exe), `Chromium is required at ${exe}`);
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const page = await context.newPage();
  const errors: string[] = [];
  const logs: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") logs.push(m.text().slice(0, 300));
  });
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Olivia Owner");
    await page.getByTestId("claim-username").fill("olivia");
    await page.getByTestId("claim-password").fill(PASSWORD);
    await page.getByTestId("claim-confirm").fill(PASSWORD);
    await page.getByTestId("claim-next").click();
    await page.getByTestId("claim-create").click();
    await dismissOnboarding(page);
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    await page.goto(`${web.origin}/automations`, { waitUntil: "load" });
    await page.getByText("No automations yet.", { exact: true }).first().waitFor({ timeout: 20_000 });
    await page.getByTestId("fp-examples").click({ timeout: 20_000 });
    await page.locator("[data-testid^='use-']").first().click({ timeout: 20_000 });
    await page.getByTestId("story").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/7-list-after-template-d.png` });
    assert.ok(
      await page
        .locator("[data-testid^='row-auto-']:not([data-testid$='-leading']):not([data-testid$='-trailing'])")
        .count(),
      "the new Automation is in the list at once",
    );
    assert.equal(/No automations yet/.test(await page.locator("body").innerText()), false, "the empty line is gone");
    // New automation from the first page adds a row too
    await page.getByTestId("automations-home").click();
    await page.getByTestId("fp-new").click();
    await page.getByTestId("story").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/7-list-after-new-d.png` });
    const rows = await page
      .locator("[data-testid^='row-auto-']:not([data-testid$='-leading']):not([data-testid$='-trailing'])")
      .allInnerTexts();
    assert.equal(rows.length, 2, `a second row after New automation: ${JSON.stringify(rows)}`);
    assert.deepEqual(errors, [], "no page error");
  } finally {
    await browser.close();
    web.close();
    await space.stop();
  }
});
