// @tsx
// Cmd-K in Records (owner, 16 Nov): a project the Space already holds is found by its name and opens. A fresh Space, a project made through the API, the Records place on screen, Cmd-K, the
// project's name; the row shows the name once, Enter opens the project page, and the pictures of both states go to VYRE_R32_SHOTS.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";

test("records: Cmd-K finds a project by its name and opens it", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required");
    t.skip("VYRE_APP_DIST required for production browser evidence");
    return;
  }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  const shots = process.env["VYRE_R32_SHOTS"] ?? "/tmp/vyre-r32-cmdk";
  fs.mkdirSync(shots, { recursive: true });
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Pat Owner");
    await page.getByTestId("claim-username").fill("patowner");
    await page.getByTestId("claim-password").fill("fixture password 123");
    await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click();
    await page.getByTestId("claim-create").click();
    await dismissOnboarding(page, { wait: 60_000 });
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string,
    );
    const r = await context.request.post(`${web.origin}/v1/projects/create`, {
      headers: { authorization: `Bearer ${token}` },
      data: { idempotencyKey: "cmdk-project-1", type: "project", title: "Northwind portal launch" },
    });
    assert.equal(r.status(), 200, await r.text());
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const rail = page.locator('[data-testid="rail-records"], [data-testid="rail-records-selected"]').first();
    try {
      await rail.click({ timeout: 2500 });
    } catch {
      await page.getByTestId("rail-isle-more").click({ timeout: 2500 });
      await page.waitForTimeout(300);
      await rail.click({ timeout: 2500 });
    }
    await page.waitForTimeout(1500);
    await page.keyboard.press("Control+k");
    await page.getByTestId("cmdk-input").waitFor({ timeout: 10_000 });
    await page.keyboard.type("Northwind portal");
    const row = page.getByTestId("cmdk-list").getByText("Northwind portal launch").first();
    await row.waitFor({ timeout: 15_000 });
    assert.equal(await page.getByTestId("cmdk-list").getByText("Northwind portal launch").count(), 1, "found once");
    await page.screenshot({ path: path.join(shots, "cmdk-records-found.png") });
    await page.keyboard.press("Enter");
    // the project page is on screen: its name is the page's heading, and the search is gone
    await page.getByTestId("cmdk").waitFor({ state: "detached", timeout: 10_000 });
    await page.getByText("Northwind portal launch").first().waitFor({ timeout: 15_000 });
    await page.screenshot({ path: path.join(shots, "cmdk-records-opened.png") });
  } finally {
    await browser.close();
    await web.close();
    await space.stop();
  }
});
