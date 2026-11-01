// Vault Add on a fresh claimed Space, in a real browser against the production export: the person pastes a key, the sheet names it, Add is live, one vault.item.put is sent and the item is in Mine and in the list.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bootFreshSpace, claimOnEdge, edge } from "./real-app-harness.test.ts";

const PASSWORD = "fixture password 123";

test("production Vault Add: a pasted key gets a name, Add saves one item to Mine and the row shows", async (t) => {
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
  const puts: number[] = [];
  page.on("response", (r) => { if (r.url().endsWith("/v1/vault/item/put")) puts.push(r.status()); });
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Olivia Owner"); await page.getByTestId("claim-username").fill("olivia");
    await page.getByTestId("claim-password").fill(PASSWORD); await page.getByTestId("claim-confirm").fill(PASSWORD);
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click();
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string);

    await page.goto(`${web.origin}/vault`, { waitUntil: "load" });
    await page.getByText("Add an item", { exact: true }).first().click({ timeout: 30_000 });
    await page.getByTestId("add-search").fill("MY_SERVICE_KEY=abc123secretvalue");
    await page.getByTestId("add-name").waitFor();
    assert.equal(await page.getByTestId("add-name").inputValue(), "My service key", "a paste that names no app is named from its key");
    await page.getByTestId("add-name").fill("");
    assert.equal(await page.locator('[title="Give it a name"]').count(), 1, "a disabled Add says why, as its tooltip");
    await page.getByTestId("add-name").fill("My service key");
    await page.waitForFunction(() => document.querySelector('[data-testid="add-save"]')?.getAttribute("aria-disabled") !== "true", null, { timeout: 15_000 });
    await page.getByTestId("add-save").click();
    await page.getByText("My service key", { exact: true }).first().waitFor({ timeout: 15_000 });

    assert.deepEqual(puts, [200], "one vault.item.put, and it succeeded");
    const r = await context.request.post(`${web.origin}/v1/vault/items/list`, { headers: { authorization: `Bearer ${token}` }, data: {} });
    const items = (await r.json()).data.items as { name: string; scope: string }[];
    assert.deepEqual(items.map((i) => [i.name, i.scope]), [["My service key", "personal"]]);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); web.close(); await space.stop(); }
});
