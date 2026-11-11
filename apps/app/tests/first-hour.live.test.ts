// @tsx
// The first hour in a real browser (rc.22 client walk, journeys 2, 3 and 4): a brand-new server whose Space was never named. Shots go to VYRE_FIRST_HOUR_SHOTS and are looked at by a person.
// Proved here: the recovery code says what it is; setup lists only steps with something real behind them and ends with the truth; the people step does not say "Could not read this right now";
// the Space tile shows the Vyre letter and Console's name field is empty rather than an id; an invite link has a Copy button; an AI key the provider refuses is not "connected".
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge } from "./real-app-harness.test.ts";
import { guardCrashes } from "./crash-guard.ts";

test("first hour on a server whose Space has no name: claim, setup, name, invite, AI key", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  assert.ok(fs.existsSync(exe), `Chromium is required at ${exe}`);
  const space = await bootFreshSpace(undefined, true, true);
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const guard = guardCrashes(page);
  const shots = process.env["VYRE_FIRST_HOUR_SHOTS"] ?? "/tmp/vyre-first-hour-shots"; fs.mkdirSync(shots, { recursive: true });
  const shot = async (name: string): Promise<void> => { await page.waitForTimeout(700); await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
  const body = async (): Promise<string> => (await page.evaluate("document.body.innerText") as string).replace(/\n+/g, " | ");
  const notes: string[] = [];
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Rhea Owner"); await page.getByTestId("claim-username").fill("rhea");
    await page.getByTestId("claim-password").fill("fixture password 123"); await page.getByTestId("claim-confirm").fill("fixture password 123");
    const fp = await page.getByTestId("claim-fingerprint").innerText().catch(() => "");
    notes.push(`fingerprint line: ${fp}`);
    assert.match(fp, /^Server fingerprint .*It matches the link your server printed\./);
    await page.getByTestId("claim-next").click();
    await page.getByTestId("claim-code").waitFor({ timeout: 20_000 });
    await shot("fh-1-recovery");
    const rec = await body();
    assert.match(rec, /shown only now/); assert.match(rec, /password manager/); assert.match(rec, /forget your password/);
    await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click();
    await page.getByTestId("onboarding").waitFor({ timeout: 40_000 });
    await guard.check("setup");
    // every setup step, skipped one by one
    const titles: string[] = [];
    for (let i = 1; i <= 8; i++) {
      const t0 = await body();
      const m = /Step (\d+) of (\d+)/.exec(t0);
      if (!m) break;
      if (i === 1) { notes.push(`first step reads: ${m[0]}`); assert.equal(m[2], "6", "six steps, none of them a placeholder"); await shot("fh-2-setup-step-1"); }
      titles.push(t0.slice(t0.indexOf(m[0]), t0.indexOf(m[0]) + 400));
      assert.ok(!/not set up yet|Nothing to do here yet/.test(t0), `step ${i} is not a placeholder: ${t0.slice(-200)}`);
      if (Number(m[1]) === 5) { await page.waitForTimeout(2500); const t5 = await body(); await shot("fh-3-people-step"); assert.ok(!/Could not read this right now/.test(t5), "the people step does not look broken"); notes.push(`people step: ${t5.slice(t5.indexOf("Your team", 200), t5.indexOf("Your team", 200) + 300)}`); }
      await page.getByText("Skip for now", { exact: true }).first().click(); await page.waitForTimeout(1200);
    }
    await shot("fh-4-setup-end");
    const end = await body();
    assert.match(end, /You can start now/); assert.match(end, /6 steps are still open/); assert.ok(!/You are set up/.test(end));
    await page.getByTestId("onboarding-close").or(page.getByTestId("onboarding-x")).first().click({ timeout: 10_000 }).catch(async () => { await page.getByText("Open Vyre", { exact: true }).click(); });
    await page.getByTestId("shell").waitFor({ timeout: 20_000 });
    // the tile: the Vyre letter, never the first character of an address or an id
    const tile = (await page.getByTestId("space-tile").first().innerText()).trim();
    notes.push(`space tile letter: ${tile}`);
    assert.equal(tile, "V");
    // Console, Space, General: an empty name field to fill in, not an id
    await page.goto(`${web.origin}/console`, { waitUntil: "load" });
    await page.getByTestId("row-nav-space").click(); await page.waitForTimeout(2500);
    const nameField = page.getByTestId("infra-space-name");
    await nameField.waitFor({ timeout: 20_000 });
    const nameValue = await nameField.inputValue();
    await shot("fh-5-console-space");
    notes.push(`Console Space name field value: "${nameValue}"`);
    assert.equal(nameValue, "", "no id in the name field");
    // the page may show the id on a row that says it is the Space ID; the NAME is not it
    assert.ok(!/Name \| spc_/.test(await body()), "the Name row is not the id");
    assert.equal((await page.getByTestId("space-logo-row").innerText().catch(() => "V")).trim().slice(0, 1) !== "Y", true, "the logo letter is not the Y of \"your Space\"");
    // an invite link has a Copy button
    await page.getByTestId("row-nav-access").click(); await page.waitForTimeout(2000);
    await page.getByRole("button", { name: "Invite people" }).first().click(); await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Create invite" }).click(); await page.waitForTimeout(3000);
    await shot("fh-6-invite-copy");
    assert.ok(await page.getByTestId("console-invite-link-copy").count() > 0, "Copy button beside the invite link");
    await page.getByRole("button", { name: "Done" }).click().catch(() => undefined);
    // an AI key the provider refuses is not connected
    await page.goto(`${web.origin}/settings`, { waitUntil: "load" }); await page.waitForTimeout(2500);
    await page.getByText("Your AI", { exact: true }).first().click(); await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "Add AI account" }).first().click(); await page.waitForTimeout(1000);
    await page.getByText("Anthropic", { exact: true }).first().click(); await page.waitForTimeout(1200);
    await page.locator("input").last().fill("sk-ant-api03-invalidinvalidinvalidinvalid");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.waitForTimeout(8000);
    await shot("fh-7-bad-key");
    const key = await body();
    notes.push(`after a made-up key: ${key.slice(key.lastIndexOf("Add Anthropic") - 20, key.lastIndexOf("Add Anthropic") + 400)}`);
    assert.ok(!/Added Anthropic|Anthropic is connected/.test(key), "a refused or unchecked key is not called connected");
    assert.match(key, /did not accept that key|could not reach Anthropic to check the key/);
    assert.deepEqual(errors, []);
  } finally { fs.writeFileSync(path.join(shots, "notes.txt"), notes.join("\n") + "\n"); await browser.close(); web.close(); await space.stop(); }
});
