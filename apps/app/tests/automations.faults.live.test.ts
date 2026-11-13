// The Automations faults of the owner's rc.26 walk (13 Nov 2026), in a real browser against the production export: a step that is missing its file says what to do and its card chip says "Needs a file" (not
// "needs fileId" and "error"), and the step menu of a Space that connected nothing lists no Google, Microsoft or GitHub action. Pictures go to VYRE_TEST_CAPTURE_DIR as <VYRE_SHOT_TAG>-<name>.png.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bootFreshSpace, claimOnEdge, dismissOnboarding, edge } from "./real-app-harness.test.ts";

const PASSWORD = "fixture password 123";

test("production Automations: missing input in words, and a step menu with only what is connected", async () => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    assert.fail("VYRE_APP_DIST required: a walk that skips without the app build is not a pass");
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
    await page.getByTestId("claim-saved").click();
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

    // the first page: a setup is offered for Acme, and never for Google_DWD (the assistant could not finish that one)
    await page.goto(`${web.origin}/automations`, { waitUntil: "load" });
    await page.getByTestId("automations-start").waitFor({ timeout: 30_000 });
    await page.getByText("Set up Acme for Automations?").waitFor({ timeout: 30_000 });
    await shoot("start-offers");
    const first = await page.locator("body").innerText();
    assert.equal(first.includes("Google_DWD"), false, "a setup for Google_DWD is offered");
    assert.match(first, /Your assistant will be allowed to build connectors/);

    await page.goto(`${web.origin}/automations`, { waitUntil: "load" });
    await page.getByText("Contract to sign", { exact: true }).first().click({ timeout: 30_000 });
    await page.getByTestId("canvas-frame").first().waitFor({ timeout: 20_000 });
    const chip = page.getByTestId("chip-n1");
    await chip.waitFor({ timeout: 20_000 });
    await shoot("step-missing-file");
    const chipText = (await chip.innerText()).trim();
    const body = await page.locator("body").innerText();
    assert.equal(chipText, "Needs a file", `the chip says ${chipText}`);
    assert.equal(/fileId/.test(body), false, "a field key is on the page");
    assert.equal(/^error$/im.test(body), false, "the bare word error is on the page");
    assert.match(body, /choose the file to send for signature/);

    // the step menu: this Space connected nothing, so no app's actions are listed
    await page.getByTestId("add-Add a step after Send for signature").click();
    const menu = page.getByRole("menu").last();
    await menu.waitFor({ timeout: 10_000 });
    await shoot("step-menu");
    const items = await menu.innerText();
    // the menu is the step menu (Vyre's own steps are in it), and no app that was never connected is
    assert.match(items, /Send an email/, "this is the step menu");
    for (const app of ["Microsoft", "GitHub", "Google"])
      assert.equal(items.includes(app), false, `${app} is in the menu`);
    assert.deepEqual(errors, [], "no page error");
  } finally {
    await browser.close();
    web.close();
    await space.stop();
  }
});
