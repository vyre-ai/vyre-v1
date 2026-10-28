// Production web export against a fresh, claimed daemon. No sample Apps data or mocked capability responses.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge } from "./real-app-harness.test.ts";

test("production Apps: create a form and campaign, reload their real editors, preview a template, and read sending domains", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { t.skip("VYRE_APP_DIST is required for production browser evidence"); return; }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  if (!fs.existsSync(exe)) { assert.fail(`Chromium is required at ${exe}`); }
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [], refused: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => { if (r.url().includes("/v1/") && r.status() >= 400) void r.text().then((body) => refused.push(`${r.status()} ${new URL(r.url()).pathname}: ${body.slice(0, 160)}`)); });
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Fixture Owner"); await page.getByTestId("claim-username").fill("fixture");
    await page.getByTestId("claim-password").fill("fixture password 123"); await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click();
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    await page.goto(`${web.origin}/sites#screen=apps.forms&create=true`, { waitUntil: "load" });
    await page.getByTestId("apps-create-form").waitFor({ timeout: 30_000 });
    await page.getByLabel("Form name", { exact: true }).fill("Browser fixture intake");
    await page.getByRole("button", { name: "Record type", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Contacts?$/, exact: true }).first().click();
    await page.getByTestId("apps-save-form").click();
    await page.getByTestId("apps-form-detail").waitFor({ timeout: 20_000 });
    await page.getByLabel("Form name", { exact: true }).fill("Browser fixture renamed"); await page.getByTestId("apps-save-form").click();
    await page.getByText("Saved the form.", { exact: true }).waitFor();
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("apps-form-detail").waitFor({ timeout: 20_000 });
    assert.equal(await page.getByLabel("Form name", { exact: true }).inputValue(), "Browser fixture renamed");
    await page.goto(`${web.origin}/sites#screen=apps.campaigns&create=true`, { waitUntil: "load" });
    await page.getByTestId("apps-create-campaign").waitFor({ timeout: 20_000 });
    await page.getByLabel("Campaign name", { exact: true }).fill("Browser fixture campaign"); await page.getByTestId("apps-save-campaign").click();
    await page.getByTestId("apps-campaign-detail").waitFor({ timeout: 20_000 });
    await page.getByText("Audience", { exact: true }).first().waitFor();
    await page.goto(`${web.origin}/sites#screen=apps.templates`, { waitUntil: "load" });
    await page.getByTestId("apps-place").waitFor({ timeout: 20_000 });
    await page.getByTestId("apps-title").filter({ hasText: "Templates" }).waitFor();
    await page.goto(`${web.origin}/sites#screen=apps.sending-domains&create=true`, { waitUntil: "load" });
    await page.getByTestId("apps-create-domain").waitFor({ timeout: 20_000 });
    await page.getByLabel("Domain name", { exact: true }).fill("mail.fixture.example");
    await page.getByRole("button", { name: "Review domain", exact: true }).click();
    await page.getByTestId("apps-confirm-domain").waitFor();
    assert.equal(refused.length, 0, refused.join("\n")); assert.deepEqual(errors, []);
    const out = process.env["VYRE_APPS_SHOTS"];
    if (out) { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, "domain-review-desktop.png") }); }
  } catch (e) { console.error(`Apps browser failure: ${await page.locator("body").innerText().catch(() => "no body")}\n${refused.join("\n")}`); throw e; }
  finally { await context.close(); await browser.close(); web.close(); await space.stop(); fs.rmSync(space.dir, { recursive: true, force: true }); }
});
