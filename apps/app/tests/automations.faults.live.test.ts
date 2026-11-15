// (Rewritten for the new Automations screen, AUTOMATIONS-BUILD-RC29.) The Automations faults of the owner's rc.26 walk (13 Nov 2026), in a real browser against the production export: a step that is missing its file says what to do and its card chip says "Needs a file" (not
// "needs fileId" and "error"), and the step menu of a Space that connected nothing lists no Google, Microsoft or GitHub action. Pictures go to VYRE_TEST_CAPTURE_DIR as <VYRE_SHOT_TAG>-<name>.png.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bootFreshSpace, claimOnEdge, dismissOnboarding, edge } from "./real-app-harness.test.ts";

const PASSWORD = "fixture password 123";

test("production Automations: missing input in words, and a step menu with only what is connected", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    // as every walk: required (the release-evidence walks job runs it with --no-skip, where a skip fails), skipped in a shard that has no app build
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
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const dir = process.env["VYRE_TEST_CAPTURE_DIR"];
  const tag = process.env["VYRE_SHOT_TAG"] ?? "after";
  const shoot = async (name: string): Promise<void> => {
    if (!dir) return;
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: `${dir}/${tag}-${name}.png` });
  };
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
    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string,
    );
    // two saved Vault items: Google_DWD (a company key only the server uses) and Acme (an ordinary app key)
    const auth = { authorization: `Bearer ${token}` };
    const folder = await context.request.post(`${web.origin}/v1/vault/folders/create`, {
      headers: auth,
      data: { name: "Keys", scope: "shared", idempotencyKey: "faults-folder" },
    });
    assert.equal(folder.status(), 200, await folder.text());
    const folderId = ((await folder.json()) as { data: { folder: { id: string } } }).data.folder.id;
    for (const name of ["Google_DWD", "Acme"]) {
      const put = await context.request.post(`${web.origin}/v1/vault/item/put`, {
        headers: auth,
        data: {
          folderId,
          name,
          kind: "api_key",
          fields: [{ key: "api_key", value: "plain-fake-value" }],
          idempotencyKey: `faults-${name}`,
        },
      });
      assert.equal(put.status(), 200, await put.text());
    }
    const made = await context.request.post(`${web.origin}/v1/automations/create`, {
      headers: { authorization: `Bearer ${token}` },
      data: {
        name: "Contract to sign",
        idempotencyKey: "faults-sign",
        definition: { triggers: [{ key: "manual" }], nodes: [{ id: "n1", key: "sign", input: {} }], start: ["n1"] },
      },
    });
    assert.equal(made.status(), 200, await made.text());

    // Rewritten for the new Automations screen (AUTOMATIONS-BUILD-RC29): the same faults through the new door. The old walk drove the canvas (card-n1, chip-n1, the step menu).
    // the first page: a setup is offered for Acme, and never for Google_DWD (the assistant could not finish that one)
    await page.goto(`${web.origin}/automations`, { waitUntil: "load" });
    await page.getByTestId("first-page").waitFor({ timeout: 30_000 });
    await page.getByText("Acme", { exact: false }).first().waitFor({ timeout: 30_000 });
    await shoot("start-offers");
    const first = await page.locator("body").innerText();
    assert.equal(first.includes("Google_DWD"), false, "a setup for Google_DWD is offered");
    assert.match(first, /Your assistant will be allowed to build connectors/);

    // a step missing its file says what to do on its row, as one orange line and one button: never "fileId", never the bare word error
    await page.getByText("Contract to sign", { exact: true }).first().click({ timeout: 30_000 });
    await page.getByTestId("story").waitFor({ timeout: 20_000 });
    const need = page.getByTestId("sv-need-n1");
    await need.waitFor({ timeout: 20_000 });
    await shoot("step-missing-file");
    const body = await page.locator("body").innerText();
    assert.equal(/fileId/.test(body), false, "a field key is on the page");
    assert.equal(/^error$/im.test(body), false, "the bare word error is on the page");
    assert.match(body, /choose the file to send for signature/i);
    assert.equal(/\(required\)|Templating|\{\{/.test(body), false, "no syntax or (required) on the page");

    // an Automation that already holds a Microsoft step, opened by a person who was never given Microsoft: it opens whole and says so in one plain line
    const ms = await context.request.post(`${web.origin}/v1/automations/create`, {
      headers: auth,
      data: {
        name: "Outlook note",
        idempotencyKey: "faults-ms",
        definition: { triggers: [{ key: "manual" }], nodes: [{ id: "m1", key: "ms.mail.send_message", input: {} }], start: ["m1"] },
      },
    });
    assert.equal(ms.status(), 200, await ms.text());
    await page.goto(`${web.origin}/automations`, { waitUntil: "load" });
    await page.getByText("Outlook note", { exact: true }).first().click({ timeout: 30_000 });
    await page.getByTestId("sv-step-m1").waitFor({ timeout: 20_000 });
    await shoot("ms-step-kept");
    // the line arrives when the full catalogue has been read: wait for it, never read the page mid-way
    await page.getByText("You cannot use Microsoft 365", { exact: false }).first().waitFor({ timeout: 20_000 });
    assert.match(await page.locator("body").innerText(), /Microsoft 365/, "the step keeps its own name and says whose it is");

    // the step picker: this Space connected nothing, so no app's actions are listed
    await page.getByText("Contract to sign", { exact: true }).first().click();
    await page.getByTestId("sv-add").click();
    await page.getByTestId("step-picker").waitFor({ timeout: 10_000 });
    await shoot("step-menu");
    const items = await page.getByTestId("pk-main").innerText();
    assert.match(items, /Messages/, "this is the step picker (Vyre's own groups are in it)");
    for (const app of ["Microsoft", "GitHub", "Google"]) assert.equal(items.includes(app), false, `${app} is in the picker`);
    await page.keyboard.press("Escape");
    assert.deepEqual(errors, [], "no page error");
  } finally {
    await browser.close();
    web.close();
    await space.stop();
  }
});
