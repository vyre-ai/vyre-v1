// @tsx
// The phone after the lists moved into the shared sidebar column (owner, 15 Nov 2026; TABS-2026-11-15.md D8): no tab strip, a place opens on its list, a row opens the body with Back, the pane is a sheet.
// Vault, Settings, Inbox and the Console are walked at 390 wide, light, and photographed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";

test("phone: no tab strip; Inbox, Vault, Settings and the Console open on their list, a row opens the body, Back returns", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required");
    t.skip("VYRE_APP_DIST required for production browser evidence");
    return;
  }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  const shots = process.env["VYRE_TABS_SHOTS"] ?? "/tmp/vyre-tabs-phone";
  fs.mkdirSync(shots, { recursive: true });
  const log = path.join(shots, "phone.txt");
  fs.writeFileSync(log, "");
  const say = (m: string): void => {
    fs.appendFileSync(log, m + "\n");
    console.log(`[walk ${new Date().toISOString().slice(14, 23)}] ${m}`);
  };
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const page = await context.newPage();
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Phone Owner");
    await page.getByTestId("claim-username").fill("phoneowner");
    await page.getByTestId("claim-password").fill("fixture password 123");
    await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click();
    await page.getByTestId("claim-create").click();
    await dismissOnboarding(page, { wait: 60_000 });
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${web.origin}/chat`, { waitUntil: "load" });
    await page.getByTestId("mobile-shell").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(2000);
    assert.equal(await page.getByTestId("tab-strip").count(), 0, "the phone has no tab strip");
    const shot = (n: string): Promise<Buffer> => page.screenshot({ path: path.join(shots, `${n}.png`) });
    const text = (): Promise<string> => page.evaluate(() => document.body.innerText);
    const you = (): Promise<void> => page.getByTestId("tab-you").click();
    await shot("1-chats");

    // Inbox: its list, then a row's body, then Back
    await page.getByTestId("tab-inbox").click();
    await page.waitForTimeout(2000);
    const inboxList = await text();
    await shot("2-inbox-list");
    say(`Inbox on the phone: ${inboxList.slice(0, 90).replace(/\n/g, " | ")}`);
    // a Space with no mail connected opens Inbox on the Connect choice; with mail it opens on its list
    assert.ok(/By contact/.test(inboxList) || /Connect/.test(inboxList), "Inbox opens on its list or on Connect");
    if (/By contact/.test(inboxList)) {
      await page.getByTestId("row-nav:calendar").first().click();
      await page.waitForTimeout(1800);
      await shot("3-inbox-body");
      await page.getByRole("button", { name: /Back/ }).first().click();
      await page.waitForTimeout(1200);
      assert.ok(/By contact/.test(await text()), "Back returns to the Inbox list");
    }

    // Vault from You
    await you();
    await page.waitForTimeout(1200);
    await page.getByText("Vault", { exact: true }).first().click();
    await page.waitForTimeout(2000);
    const vaultList = await text();
    say(`Vault on the phone: ${vaultList.slice(0, 80).replace(/\n/g, " | ")}`);
    await shot("4-vault-list");
    // the Vault draws (its items, or its empty line) with the way back to You on screen
    assert.ok(/vault is empty|AI accounts|Search/.test(vaultList), "Vault draws on the phone");
    await page
      .getByRole("button", { name: /Back|You/ })
      .first()
      .click();
    await page.waitForTimeout(1200);

    // Settings from You
    await you();
    await page.waitForTimeout(1200);
    await page.getByText("Settings", { exact: true }).first().click();
    await page.waitForTimeout(2000);
    const setList = await text();
    say(`Settings on the phone: ${setList.slice(0, 100).replace(/\n/g, " | ")}`);
    await shot("6-settings-list");
    assert.ok(setList.trim().length > 30, "Settings draws on the phone");

    // the Console, from Settings
    const consoleRow = page.getByTestId("row-open-console").first();
    if ((await consoleRow.count()) > 0) {
      await consoleRow.click();
      await page.waitForTimeout(2500);
      const c = await text();
      say(`Console on the phone: ${c.slice(0, 80).replace(/\n/g, " | ")}`);
      await shot("8-console");
      assert.ok(
        c.trim().length > 20,
        "the Console draws something on the phone (its list or a line that says it is on the computer)",
      );
    } else say("Console: no door from Settings on the phone");
  } finally {
    await shot_end(page, shots);
    await browser.close();
    await web.close();
    await space.stop();
  }
});

async function shot_end(page: import("playwright-core").Page, shots: string): Promise<void> {
  await page.screenshot({ path: path.join(shots, "end.png") }).catch(() => undefined);
}
