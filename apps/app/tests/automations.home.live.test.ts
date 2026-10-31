// Automations in a real browser against the production export: a draft opens without a crash, and the Automations row in the sidebar leaves it and shows the list again (it used to do nothing once an automation was open).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bootFreshSpace, claimOnEdge, edge } from "./real-app-harness.test.ts";

const PASSWORD = "fixture password 123";

test("production Automations: open a draft, then the Automations row goes back to the list", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  assert.ok(fs.existsSync(exe), `Chromium is required at ${exe}`);
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Olivia Owner"); await page.getByTestId("claim-username").fill("olivia");
    await page.getByTestId("claim-password").fill(PASSWORD); await page.getByTestId("claim-confirm").fill(PASSWORD);
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click();
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string);
    const made = await context.request.post(`${web.origin}/v1/automations/create`, { headers: { authorization: `Bearer ${token}` }, data: { name: "Welcome new leads", idempotencyKey: "browser-home-draft" } });
    assert.equal(made.status(), 200);

    await page.goto(`${web.origin}/automations`, { waitUntil: "load" });
    await page.getByText("Welcome new leads", { exact: true }).first().click({ timeout: 30_000 });
    await page.getByTestId("canvas-frame").first().waitFor({ timeout: 20_000 });
    await page.getByTestId("nav-automations").click();
    await page.getByTestId("automations-start").waitFor({ timeout: 10_000 });
    assert.deepEqual(errors, [], "no page error while opening and leaving an automation");
  } finally { await browser.close(); web.close(); await space.stop(); }
});
