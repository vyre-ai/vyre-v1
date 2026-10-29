// Publisher-approved public choices in Chromium against the production export and a fresh claimed daemon. The publisher cannot publish a form with a required relation question until they pick which
// records visitors may choose (Build, Public choices); the public page then offers exactly those labels and nothing else, and a visitor's pick lands as a real relation on the new record.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge } from "./real-app-harness.test.ts";

test("production Apps: Public choices guard, picking, exact public labels, and a visitor's pick becomes a relation", async (t) => {
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
  const logs: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") logs.push(m.text().slice(0, 600)); });
  const shots = process.env["VYRE_FORM_CHOICES_SHOTS"] ?? "/tmp/vyre-form-choices-shots"; fs.mkdirSync(shots, { recursive: true });
  const shot = async (name: string, p = page): Promise<void> => { await p.screenshot({ path: path.join(shots, `${name}.png`), animations: "disabled" }); };
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Choices Owner"); await page.getByTestId("claim-username").fill("choicesowner");
    await page.getByTestId("claim-password").fill("fixture password 123"); await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click();
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string);
    const api = async (cap: string, data: unknown): Promise<any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await context.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data });
      assert.equal(r.status(), 200, `${cap}: ${await r.text()}`); return (await r.json()).data;
    };
    const company = async (name: string): Promise<string> => (await api("records.create", { type: "company", fields: { name }, idempotencyKey: `choices-${name}` })).record.id as string;
    const acme = await company("Northwind Traders"), globex = await company("Contoso Supply"), hidden = await company("Hidden Holdings");

    await page.goto(`${web.origin}/sites`, { waitUntil: "load" });
    await page.getByTestId("apps-new-group").click();
    await page.getByRole("menuitem", { name: "New form", exact: true }).click();
    await page.getByTestId("apps-create-form").waitFor({ timeout: 30_000 });
    await page.getByLabel("Form name", { exact: true }).fill("Choices fixture");
    await page.getByRole("button", { name: "Record type", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Contacts?$/, exact: true }).first().click();
    await page.getByTestId("apps-save-form").click();
    await page.getByTestId("apps-form-detail").waitFor({ timeout: 20_000 });
    for (const label of ["Email", "Name", "Company"]) { await page.getByRole("button", { name: `Mode for ${label}`, exact: true }).click(); await page.getByRole("menuitem", { name: "Ask", exact: true }).click(); await page.getByTestId("menu").waitFor({ state: "detached" }); }
    await page.getByTestId("apps-save-form").click(); await page.getByText("Saved the form.", { exact: true }).waitFor();
    const form = (await api("forms.list", {})).forms.find((f: { name: string }) => f.name === "Choices fixture");
    const formId = form.formId as string, slug = form.slug as string;
    // Company is made required by a rule, so the publish guard applies
    await api("forms.design_set", { formId, logic: { rules: [{ when: { field: "email", op: "empty" }, require: ["company"] }, { when: { field: "email", op: "not_empty" }, require: ["company"] }] } });
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("apps-form-detail").waitFor({ timeout: 20_000 });

    await t.test("publishing is blocked until the publisher picks choices", async () => {
      await page.getByTestId("apps-preview-form").click();
      assert.match(await page.getByRole("alert").first().innerText(), /Company has no public choices yet.*blocks publishing/s);
      assert.equal(await page.getByTestId("apps-confirm-publish").isDisabled(), true);
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.deepEqual((await api("forms.get", { formId })).choices ?? {}, {});
    });

    await t.test("the publisher picks which companies visitors may choose; the preview draws those labels", async () => {
      const card = page.getByTestId("apps-choices-company");
      await card.waitFor();
      for (const id of [acme, globex, hidden]) await page.getByTestId(`row-choice-company-${id}`).waitFor();
      await page.getByTestId(`row-choice-company-${acme}`).click();
      await page.getByTestId(`row-choice-company-${globex}`).click();
      await page.getByTestId("apps-choices-company").scrollIntoViewIfNeeded();
      await shot("choices-picked");
      await page.getByTestId("apps-choices-save-company").click();
      await page.getByText("Saved. Visitors can pick from 2 choices.", { exact: true }).waitFor();
      const saved = (await api("forms.get", { formId })).choices.company as { label: string; refId: string }[];
      assert.deepEqual(saved.map((c) => c.label).sort(), ["Contoso Supply", "Northwind Traders"]);
      assert.ok(!saved.some((c) => c.refId === hidden));
      const options = await page.frameLocator('iframe[title="Form preview"]').locator('[data-field="company"] label').allTextContents();
      assert.deepEqual(options, ["Northwind Traders", "Contoso Supply"], "the preview offers exactly the published labels, not the record list");
    });

    await t.test("the publish guard clears and the form publishes", async () => {
      await page.getByTestId("apps-preview-form").click();
      assert.equal(await page.getByRole("alert").count(), 0);
      assert.equal(await page.getByTestId("apps-confirm-publish").isEnabled(), true);
      await page.getByTestId("apps-confirm-publish").click();
      await page.getByText("Published form", { exact: true }).waitFor({ timeout: 15_000 });
    });

    await t.test("the public page offers exactly those labels with opaque keys, and a visitor's pick becomes a real relation", async () => {
      const visitor = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const pub = await visitor.newPage();
      pub.on("pageerror", (e) => errors.push(`public: ${e.message}`));
      await pub.goto(`${space.url}/f/${slug}`, { waitUntil: "load" });
      const options = pub.locator('select[data-field="company"] option');
      assert.deepEqual(await options.allTextContents(), ["Northwind Traders", "Contoso Supply"]);
      const html = await pub.content();
      for (const secret of [acme, globex, hidden, "Hidden Holdings"]) assert.ok(!html.includes(secret), `the public page leaked ${secret}`);
      const keys = await options.evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value).filter(Boolean));
      assert.ok(keys.length === 2 && keys.every((k) => /^chc_/.test(k)));
      await shot("public-choices", pub);
      await pub.locator('input[data-field="email"]').fill("visitor@example.com");
      await pub.locator('input[data-field="name"]').fill("Visiting Vera");
      await pub.locator('select[data-field="company"]').selectOption([{ label: "Northwind Traders" }, { label: "Contoso Supply" }]);
      await pub.locator("#vf-send").click();
      await pub.locator("#vf-thanks:not([hidden])").waitFor({ timeout: 15_000 });
      const rows = (await api("records.query", { type: "contact", limit: 50 })).rows as { fields: Record<string, unknown> }[];
      const mine = rows.find((r) => r.fields["email"] === "visitor@example.com");
      assert.ok(mine, "the answer was written");
      assert.ok(JSON.stringify(mine!.fields["company"]).includes(acme) && JSON.stringify(mine!.fields["company"]).includes(globex), `the record carries both real relations: ${JSON.stringify(mine!.fields["company"])}`);
      // a visitor who guesses the record id gets nothing written
      const guess = await visitor.request.post(`${space.url}/f/submit`, { data: { slug, answers: { email: "thief@example.com", company: hidden } } });
      assert.equal(guess.status(), 422);
      const after = (await api("records.query", { type: "contact", limit: 50 })).rows as { fields: Record<string, unknown> }[];
      assert.ok(!after.some((r) => r.fields["email"] === "thief@example.com"));
      await visitor.close();
    });

    await t.test("a record removed after publishing is flagged in Build and stops being offered", async () => {
      await api("records.delete", { type: "company", recordId: globex });
      await page.reload({ waitUntil: "load" });
      await page.getByTestId("apps-form-detail").waitFor({ timeout: 20_000 });
      await page.getByTestId(`row-choice-company-${globex}`).waitFor();
      assert.match(await page.getByTestId(`row-choice-company-${globex}`).innerText(), /Unavailable.*Saving removes it/s);
      await page.getByTestId(`row-choice-company-${globex}`).scrollIntoViewIfNeeded();
      await shot("choices-gone");
      const pub = await context.newPage();
      await pub.goto(`${space.url}/f/${slug}`, { waitUntil: "load" });
      // the stored label is all the page knows; the submit is what refuses it
      const globexKey = (await api("forms.get", { formId })).choices.company.find((c: { refId: string }) => c.refId === globex).key as string;
      const refused = await context.request.post(`${space.url}/f/submit`, { data: { slug, answers: { email: "late@example.com", company: globexKey } } });
      assert.equal(refused.status(), 422);
      await pub.close();
    });
    assert.deepEqual(errors, []);
  } catch (error) {
    await page.screenshot({ path: path.join(shots, "failure.png") }).catch(() => undefined);
    fs.writeFileSync(path.join(shots, "failure.txt"), `${String(error)}\n${logs.join("\n")}\n${await page.locator("body").innerText().catch(() => "")}`);
    throw error;
  } finally { await context.close(); await browser.close(); web.close(); await space.stop(); fs.rmSync(space.dir, { recursive: true, force: true }); }
});
