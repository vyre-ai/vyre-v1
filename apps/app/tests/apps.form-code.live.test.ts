// The form Code tab and inline Ask in Chromium against the production export and a fresh claimed daemon. The author writes HTML, CSS and JavaScript, Build keeps working beside them, the public page serves it
// sandboxed (script cannot reach the Space's storage) and still takes answers, and Ask proposes changes the author accepts or rejects field by field. The Ask is a real agent turn; only the model vendor is a
// local stand-in that api.openai.com requests are sent to inside the daemon process.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootFreshSpace, claimOnEdge, edge } from "./real-app-harness.test.ts";
import { vendor } from "../../../fixtures/model-vendor.ts";

const PRELOAD = fileURLToPath(new URL("../../../fixtures/model-vendor-preload.mjs", import.meta.url));
const KEY = "sk-test-fixture-0123456789abcdef"; // secret-scan: fake
const HTML = '<h1>Contact us</h1>\n<vyre-field name="email"></vyre-field>\n<p>We reply within a day.</p>';
const JS = 'document.getElementById("vf-form").setAttribute("data-authored", "yes");try{void localStorage.getItem("vyre.session.v1");document.documentElement.setAttribute("data-storage","open");}catch(e){document.documentElement.setAttribute("data-storage","blocked");}';

test("production Apps: form Code tab, sandboxed public page and inline Ask with per-field review", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  assert.ok(fs.existsSync(exe), `Chromium is required at ${exe}`);
  const v = await vendor();
  const priorOptions = process.env["NODE_OPTIONS"];
  process.env["NODE_OPTIONS"] = `${priorOptions ?? ""} --import ${PRELOAD}`.trim();
  process.env["VYRE_TEST_VENDOR"] = v.base;
  const space = await bootFreshSpace(undefined, true);
  if (priorOptions === undefined) delete process.env["NODE_OPTIONS"]; else process.env["NODE_OPTIONS"] = priorOptions;
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const shots = process.env["VYRE_FORM_CODE_SHOTS"] ?? "/tmp/vyre-form-code-shots"; fs.mkdirSync(shots, { recursive: true });
  const shot = async (name: string, p = page): Promise<void> => { await p.screenshot({ path: path.join(shots, `${name}.png`), animations: "disabled" }); };
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Form Owner"); await page.getByTestId("claim-username").fill("formowner");
    await page.getByTestId("claim-password").fill("fixture password 123"); await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click();
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string);
    const api = async (cap: string, data: unknown): Promise<any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await context.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data });
      assert.equal(r.status(), 200, `${cap}: ${await r.text()}`); return (await r.json()).data;
    };
    const provider = await api("providers.add", { idempotencyKey: "fc-provider", providerKey: "openai", connection: "api_key", apiKey: KEY, scope: "mine" });
    await api("providers.set_space_use", { idempotencyKey: "fc-spaceuse", providerId: provider.provider.id, allow: true });
    await api("agents.create", { name: "Builder", role: "You edit forms.", model: "gpt-4o-mini", idempotencyKey: "fc-agent" });

    // a form made in the app, its questions chosen in Build
    await page.goto(`${web.origin}/sites`, { waitUntil: "load" });
    await page.getByTestId("apps-new-group").click();
    await page.getByRole("menuitem", { name: "New form", exact: true }).click();
    await page.getByTestId("apps-create-form").waitFor({ timeout: 30_000 });
    await page.getByLabel("Form name", { exact: true }).fill("Code fixture");
    await page.getByRole("button", { name: "Record type", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Contacts?$/, exact: true }).first().click();
    await page.getByTestId("apps-save-form").click();
    await page.getByTestId("apps-form-detail").waitFor({ timeout: 20_000 });
    for (const label of ["Email", "Name"]) { await page.getByRole("button", { name: `Mode for ${label}`, exact: true }).click(); await page.getByRole("menuitem", { name: "Ask", exact: true }).click(); await page.getByTestId("menu").waitFor({ state: "detached" }); }
    await page.getByTestId("apps-save-form").click(); await page.getByText("Saved the form.", { exact: true }).waitFor();
    const form = (await api("forms.list", {})).forms.find((f: { name: string }) => f.name === "Code fixture");
    const formId = form.formId as string, slug = form.slug as string;

    await t.test("the Code tab writes HTML, CSS and JavaScript; Generate from Build places the questions; a bad source is refused live", async () => {
      await page.getByRole("button", { name: "Code", exact: true }).click();
      await page.getByTestId("apps-form-code").waitFor();
      await page.getByTestId("apps-code-generate").click();
      assert.match(await page.getByLabel("HTML", { exact: true }).inputValue(), /<vyre-field name="email"><\/vyre-field>\n<vyre-field name="name"><\/vyre-field>/, "Generate places every asked question");
      await page.getByLabel("HTML", { exact: true }).fill('<h1>Hi</h1>\n<script>alert(1)</script>');
      await page.getByTestId("apps-code-html-error").waitFor();
      assert.match(await page.getByTestId("apps-code-html-error").innerText(), /line 2: <script> is not allowed/);
      assert.equal(await page.getByTestId("apps-save-form").isEnabled(), false, "Save is blocked on a source the server would refuse");
      await page.getByLabel("HTML", { exact: true }).fill(HTML);
      await page.getByTestId("apps-code-unplaced").waitFor();
      assert.match(await page.getByTestId("apps-code-unplaced").innerText(), /Not placed in your HTML \(shown after it\): Name/);
      await page.getByLabel("Custom CSS", { exact: true }).fill("h1 { color: rgb(1, 2, 3); }");
      await page.getByLabel("JavaScript", { exact: true }).fill(JS);
      await shot("code-tab");
      await page.getByTestId("apps-save-form").click();
      // the "Saved the form." notice is drawn on the Build side; the proof is the saved design itself
      let saved = await api("forms.get", { formId });
      for (let i = 0; i < 100 && saved.html !== HTML; i++) { await new Promise((r) => setTimeout(r, 100)); saved = await api("forms.get", { formId }); }
      assert.deepEqual([saved.html, saved.css, saved.js], [HTML, "h1 { color: rgb(1, 2, 3); }", JS], "saved exactly as written");
      // the preview draws the author's markup with the bound input in place, and runs the script in its own sandbox
      const preview = page.frameLocator('iframe[title="Form preview"]');
      await preview.locator("h1", { hasText: "Contact us" }).waitFor();
      assert.ok((await preview.locator("body").innerText()).indexOf("Contact us") < (await preview.locator("body").innerText()).indexOf("We reply within a day"));
      await preview.locator('form#vf-form[data-authored="yes"]').waitFor({ timeout: 10_000 });
      assert.equal(await page.locator('iframe[title="Form preview"]').getAttribute("sandbox"), "allow-scripts");
    });

    await t.test("Build keeps working beside the source: changing questions leaves the HTML, CSS and JavaScript as written", async () => {
      await page.getByRole("button", { name: "Build", exact: true }).click();
      await page.getByRole("button", { name: "Mode for Company", exact: true }).click(); await page.getByRole("menuitem", { name: "Ask", exact: true }).click(); await page.getByTestId("menu").waitFor({ state: "detached" });
      await page.getByTestId("apps-save-form").click(); await page.getByText("Saved the form.", { exact: true }).waitFor();
      const saved = await api("forms.get", { formId });
      assert.deepEqual([saved.html, saved.js], [HTML, JS]);
      assert.equal(saved.fields.filter((f: { mode: string }) => f.mode === "ask").length, 3);
      await page.getByRole("button", { name: "Code", exact: true }).click();
      assert.match(await page.getByTestId("apps-code-unplaced").innerText(), /Name, Company|Company, Name/);
    });

    await t.test("the public page serves the source sandboxed: the author's script runs but cannot reach the Space's storage, and answers still arrive", async () => {
      await api("forms.publish", { formId });
      const pub = await context.newPage();
      pub.on("pageerror", (e) => errors.push(`public: ${e.message}`));
      // a signed-in member opens the public form: the page is on the Space's own origin, yet its script must not see this browser's session
      await pub.goto(`${space.url}/f/${slug}`, { waitUntil: "load" });
      await pub.locator('form#vf-form[data-authored="yes"]').waitFor({ timeout: 10_000 });
      assert.equal(await pub.locator("html").getAttribute("data-storage"), "blocked", "script runs in an opaque origin: localStorage is unreachable");
      const authored = pub.locator("h1", { hasText: "Contact us" });
      assert.equal(await authored.count(), 1);
      assert.equal(await authored.evaluate((el) => getComputedStyle(el).color), "rgb(1, 2, 3)", "the author's CSS applies");
      const order = await pub.locator("main").innerText();
      assert.ok(order.indexOf("Contact us") < order.indexOf("Email") && order.indexOf("We reply within a day") < order.indexOf("Name"), "inputs sit where placed; unplaced questions follow");
      await shot("public-page", pub);
      // the bound inputs submit through the sandbox to the public address (CORS), and the answer lands in the record
      await pub.locator('input[data-field="email"]').fill("visitor@example.com");
      await pub.locator('input[data-field="name"]').fill("Visiting Vera");
      await pub.locator("#vf-send").click();
      await pub.locator("#vf-thanks:not([hidden])").waitFor({ timeout: 15_000 });
      const rows = (await api("records.query", { type: "contact", limit: 50 })).rows as { fields: Record<string, unknown> }[];
      assert.ok(rows.some((r) => r.fields["email"] === "visitor@example.com" && r.fields["name"] === "Visiting Vera"), "the answer was written to the record");
      await pub.close();
    });

    await t.test("Ask proposes source changes inline; each is accepted or rejected on its own; nothing is saved until Save", async () => {
      await page.reload({ waitUntil: "load" });
      await page.getByTestId("apps-form-detail").waitFor({ timeout: 20_000 });
      await page.getByRole("button", { name: "Code", exact: true }).click();
      await page.getByTestId("apps-form-ask").waitFor();
      v.script.push({ text: JSON.stringify({ html: `<h1>Contact us</h1>\n<vyre-field name="email"></vyre-field>\n<p>We reply within a day.</p>\n<p>Privacy: <a href="https://example.com/privacy">read this</a></p>`, css: "h1 { color: red; }" }) });
      await page.getByLabel("What should change?", { exact: true }).fill("Add a privacy link and make the heading red");
      await page.getByTestId("apps-ask-send").click();
      await page.getByTestId("apps-ask-accept-html").waitFor({ timeout: 60_000 });
      assert.match(v.requests.at(-1)!, /Add a privacy link/, "the model received the instruction");
      assert.match(v.requests.at(-1)!, /vyre-field/, "and the current source");
      const diff = await page.getByTestId("apps-ask-diff").innerText();
      assert.match(diff, /HTML[\s\S]*\+ <p>Privacy: <a href="https:\/\/example.com\/privacy">read this<\/a><\/p>/); assert.match(diff, /CSS[\s\S]*\+ h1 \{ color: red; \}/);
      assert.equal(await page.getByLabel("HTML", { exact: true }).inputValue(), HTML, "asking changes nothing in the editor");
      await shot("ask-proposal");
      await page.getByTestId("apps-ask-accept-html").click();
      await page.getByTestId("apps-ask-reject-css").click();
      await page.getByTestId("apps-ask-accepted-html").waitFor(); await page.getByTestId("apps-ask-rejected-css").waitFor();
      assert.match(await page.getByLabel("HTML", { exact: true }).inputValue(), /Privacy: <a href/, "Accept puts the change in the editor");
      assert.equal(await page.getByLabel("Custom CSS", { exact: true }).inputValue(), "h1 { color: rgb(1, 2, 3); }", "Reject leaves the CSS alone");
      assert.match((await api("forms.get", { formId })).html, /^<h1>Contact us<\/h1>\n<vyre-field name="email"><\/vyre-field>\n<p>We reply within a day.<\/p>$/, "nothing is saved yet");
      await page.getByTestId("apps-ask-save-first").waitFor();
      await page.getByRole("button", { name: "Build", exact: true }).click();
      await page.getByTestId("apps-save-form").click(); await page.getByText("Saved the form.", { exact: true }).waitFor();
      assert.match((await api("forms.get", { formId })).html, /Privacy: <a href/, "Save keeps the accepted change");
    });

    await t.test("a refused proposal, a vendor failure and Cancel are told in words and change nothing", async () => {
      await page.getByRole("button", { name: "Code", exact: true }).click();
      v.script.push({ text: JSON.stringify({ html: "<script>steal()</script>" }) });
      await page.getByLabel("What should change?", { exact: true }).fill("Add a script");
      await page.getByTestId("apps-ask-send").click();
      await page.getByTestId("apps-ask-error").waitFor({ timeout: 60_000 });
      assert.match(await page.getByTestId("apps-ask-error").innerText(), /The agent's HTML is not valid: line 1: <script> is not allowed/);
      v.script.push({ status: 401 });
      await page.getByTestId("apps-ask-send").click();
      await page.waitForFunction(() => /key or sign-in|reconnect/i.test(document.querySelector('[data-testid="apps-ask-error"]')?.textContent ?? ""), null, { timeout: 60_000 });
      await shot("ask-error");
      v.script.push({ hold: true });
      const seen = v.requests.length;
      await page.getByTestId("apps-ask-send").click();
      await page.getByTestId("apps-ask-cancel").waitFor({ timeout: 20_000 });
      while (v.requests.length === seen) await new Promise((r) => setTimeout(r, 50));
      await page.getByTestId("apps-ask-cancel").click();
      await page.getByTestId("apps-ask-cancel").waitFor({ state: "detached" });
      assert.match(await page.getByTestId("apps-ask-error").innerText(), /Cancelled/);
      assert.match((await api("forms.get", { formId })).html, /Privacy: <a href/, "the saved source is unchanged");
    });
    assert.deepEqual(errors, []);
  } catch (error) {
    await page.screenshot({ path: path.join(shots, "failure.png") }).catch(() => undefined);
    fs.writeFileSync(path.join(shots, "failure.txt"), `${String(error)}\n${await page.locator("body").innerText().catch(() => "")}`);
    throw error;
  } finally { await context.close(); await browser.close(); web.close(); await space.stop(); fs.rmSync(space.dir, { recursive: true, force: true }); v.close(); }
});
