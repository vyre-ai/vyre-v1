// Production web export against a fresh, claimed daemon. No sample Apps data or mocked capability responses.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge } from "./real-app-harness.test.ts";

test("production Apps: create a form and campaign, reload their real editors, install a saved draft template, and review a sending domain", async (t) => {
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
    const token = await page.evaluate(() => { const saved = JSON.parse(localStorage.getItem("vyre.session.v1")!); return saved.sessions?.[location.origin]?.token ?? saved.token; });
    const fixtureCompany = await context.request.post(`${web.origin}/v1/records/create`, { headers: { authorization: `Bearer ${token}` }, data: { type: "company", fields: { name: "Fixture relation company" }, idempotencyKey: "apps-company-fixture" } });
    assert.equal(fixtureCompany.status(), 200, await fixtureCompany.text());
    await page.goto(`${web.origin}/sites`, { waitUntil: "load" });
    await page.getByTestId("apps-new-group").click();
    await page.getByRole("menuitem", { name: "New form", exact: true }).click();
    await page.getByTestId("apps-create-form").waitFor({ timeout: 30_000 });
    await page.getByLabel("Form name", { exact: true }).fill("Browser fixture intake");
    await page.getByRole("button", { name: "Record type", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Contacts?$/, exact: true }).first().click();
    assert.equal(await page.getByTestId("apps-save-form").isEnabled(),true,"draft name/type state must persist before creation");
    await page.getByTestId("apps-save-form").click();
    await page.getByTestId("apps-form-detail").waitFor({ timeout: 20_000 });
    const formUrl=page.url();await page.goBack();await page.getByTestId("apps-create-form").waitFor();await page.goForward();await page.getByTestId("apps-form-detail").waitFor();assert.equal(page.url(),formUrl,"browser history restores the saved form");
    await page.getByRole("button", { name: "Mode for Name", exact: true }).click();
    await page.getByRole("menuitem", { name: "Ask", exact: true }).click();
    for (const label of ['Email','Company','Deliverability']) { await page.getByRole('button',{name:`Mode for ${label}`,exact:true}).click();await page.getByRole('menuitem',{name:'Ask',exact:true}).click();await page.getByTestId('menu').waitFor({state:'detached'}); }
    await page.getByLabel('Accent color',{exact:true}).fill('#123456');
    await page.getByRole('button',{name:'Add condition',exact:true}).click();
    await page.getByLabel('Match value 1',{exact:true}).fill('show');
    await page.getByRole('button',{name:'Target question 1',exact:true}).click();await page.getByRole('menuitem',{name:'Email',exact:true}).click();
    await page.getByTestId('row-name').click();
    await page.getByLabel('Preview answer',{exact:true}).fill('show');
    await page.frameLocator('iframe[title="Form preview"]').locator('input[data-field="email"]').waitFor();
    assert.ok((await page.frameLocator('iframe[title="Form preview"]').locator('select[data-field="company"] option').allTextContents()).includes('Fixture relation company'));
    assert.ok(await page.frameLocator('iframe[title="Form preview"]').locator('select[data-field="deliverability"] option').count()>1);
    await page.getByLabel('Preview answer',{exact:true}).fill('hide');
    await page.frameLocator('iframe[title="Form preview"]').locator('input[data-field="email"]').waitFor({state:'detached'});
    await page.getByRole("button", { name: "Code", exact: true }).click();
    await page.getByLabel("Custom CSS", { exact: true }).fill("input { border-color: rgb(110, 80, 190); }");
    await page.getByRole("button", { name: "Build", exact: true }).click();
    await page.getByLabel("Form name", { exact: true }).fill("Browser fixture renamed"); await page.getByTestId("apps-save-form").click();
    await page.getByText("Saved the form.", { exact: true }).waitFor();
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("apps-form-detail").waitFor({ timeout: 20_000 });
    assert.equal(await page.getByLabel("Form name", { exact: true }).inputValue(), "Browser fixture renamed");
    await page.frameLocator('iframe[title="Form preview"]').locator('input[data-field="name"]').waitFor();
    assert.equal(await page.frameLocator('iframe[title="Form preview"]').locator('input[data-field="name"]').evaluate((el) => getComputedStyle(el).borderTopColor), "rgb(110, 80, 190)");
    assert.equal(await page.getByLabel('Accent color',{exact:true}).inputValue(),'#123456');
    assert.equal(await page.frameLocator('iframe[title="Form preview"]').locator('input[data-field="email"]').count(),0);
    await page.getByTestId('row-name').click();await page.getByLabel('Preview answer',{exact:true}).fill('show');
    await page.frameLocator('iframe[title="Form preview"]').locator('input[data-field="email"]').waitFor();
    const captures = process.env["VYRE_APPS_SHOTS"];
    if (captures) { fs.mkdirSync(captures, { recursive: true }); await page.screenshot({ path: path.join(captures, "form-editor-desktop.png") }); }
    await page.getByRole("button", { name: "Back to Apps", exact: true }).click();
    await page.getByTestId("apps-head-campaigns").click();
    await page.getByTestId("apps-new-group").click();
    await page.getByRole("menuitem", { name: "New campaign", exact: true }).click();
    await page.getByTestId("apps-create-campaign").waitFor({ timeout: 20_000 });
    await page.getByLabel("Campaign name", { exact: true }).fill("Browser fixture campaign"); await page.getByTestId("apps-save-campaign").click();
    await page.getByTestId("apps-campaign-detail").waitFor({ timeout: 20_000 });
    await page.getByText("Audience", { exact: true }).first().waitFor();
    await page.getByRole("button", { name: "Back to Apps", exact: true }).click();
    await page.getByTestId("apps-head-templates").click();
    await page.getByTestId("apps-place").waitFor({ timeout: 20_000 });
    await page.getByTestId("apps-title").filter({ hasText: "Templates" }).waitFor();
    // Create a real draft fixture through the authenticated API, then save and install it through the UI.

    const source = await context.request.post(`${web.origin}/v1/automations/create`, { headers: { authorization: `Bearer ${token}` }, data: { name: "Browser fixture draft", idempotencyKey: "browser-template-source" } });
    assert.equal(source.status(), 200, await source.text());
    await page.getByTestId("apps-new").click();
    await page.getByRole("menuitem", { name: "Save as template", exact: true }).click();
    await page.getByTestId("apps-create-template").waitFor();
    await page.getByLabel("Template title", { exact: true }).fill("Browser fixture package");
    await page.getByRole("button", { name: "Source kind", exact: true }).click();
    await page.getByRole("menuitem", { name: "automation", exact: true }).click();
    await page.getByRole("button", { name: "Source object", exact: true }).click();
    await page.getByRole("menuitem", { name: "Browser fixture draft", exact: true }).click();
    await page.getByTestId("apps-save-template").click();
    await page.getByTestId("apps-template-detail").waitFor();
    await page.getByTestId("apps-preview-install").click();
    await page.getByTestId("apps-confirm-install").click();
    await page.getByText(/Installed Browser fixture package\. Added 1 items\./).waitFor();
    await page.getByRole("button", { name: "Back to Apps", exact: true }).click();
    await page.getByTestId("apps-head-domains").click();
    await page.getByTestId("apps-new-group").click();
    await page.getByRole("menuitem", { name: "Add sending domain", exact: true }).click();
    await page.getByTestId("apps-create-domain").waitFor({ timeout: 20_000 });
    await page.getByLabel("Domain name", { exact: true }).fill("mail.fixture.example");
    await page.getByRole("button", { name: "Review domain", exact: true }).click();
    await page.getByTestId("apps-confirm-domain").waitFor();
    const appRefusals = refused.filter((line) => /\/v1\/(forms|campaigns|templates|mail\/domain|email_builder)\//.test(line));
    assert.equal(appRefusals.length, 0, appRefusals.join("\n")); assert.deepEqual(errors, []);
    const out = process.env["VYRE_APPS_SHOTS"];
    if (out) { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, "domain-review-desktop.png") }); }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId("tab-you").click();
    await page.getByTestId("row-you-apps").click();
    await page.getByTestId("apps-new").click();
    await page.getByRole("menuitem", { name: "New form", exact: true }).click();
    await page.getByTestId("apps-create-form").waitFor();
    await page.getByLabel("Form name", { exact: true }).fill("Phone browser intake");
    await page.getByRole("button", { name: "Record type", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Contacts?$/, exact: true }).first().click();
    await page.getByTestId("apps-save-form").click();
    await page.getByTestId("apps-form-detail").waitFor();
    await page.getByLabel("Form name", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Form name", { exact: true }).inputValue(), "Phone browser intake");
    assert.ok((await page.getByLabel("Form name", { exact: true }).boundingBox())!.width > 250);
    await page.getByRole("button", { name: "Mode for Name", exact: true }).click();
    await page.getByRole("menuitem", { name: "Ask", exact: true }).click();
    if (out) await page.screenshot({ path: path.join(out, "form-editor-phone.png") });
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await page.getByTestId("apps-form-canvas").waitFor();
    await page.frameLocator('iframe[title="Form preview"]').locator('input[data-field="name"]').waitFor();
    if (out) await page.screenshot({ path: path.join(out, "form-preview-phone.png") });
  } catch (e) {
    const failureDir = process.env["VYRE_APPS_SHOTS"] ?? "/tmp/vyre-apps-browser-shots";
    fs.mkdirSync(failureDir, { recursive: true });
    await page.screenshot({ path: path.join(failureDir, "design-failure.png") }).catch(() => {});
    console.error("Apps first failure", e);
    console.error("preview-box", await page.locator('iframe[title="Form preview"]').boundingBox({ timeout: 1000 }).catch(() => null));
    console.error(`Apps browser failure at ${page.url()}: ${await page.locator("body").innerText().catch(() => "no body")}\n${refused.join("\n")}`);
    throw e;
  }
  finally { await context.close(); await browser.close(); web.close(); await space.stop(); fs.rmSync(space.dir, { recursive: true, force: true }); }
});
