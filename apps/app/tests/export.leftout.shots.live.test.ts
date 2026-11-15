import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { isConsoleHost } from "../src/shell/console-host.ts";
import { openConsolePage } from "./console-nav.ts";
import { guardCrashes } from "./crash-guard.ts";
test("pictures: the export screen when some files were left out and when every file was left out (dark desktop, light phone)", async (t) => {
  const dist = process.env.VYRE_APP_DIST;
  if (!dist) {
    t.skip("VYRE_APP_DIST required");
    return;
  }
  const { chromium } = await import("playwright-core");
  const executablePath = process.env.CHROME_BIN || chromium.executablePath();
  assert.ok(fs.existsSync(executablePath));
  const space = await bootFreshSpace(),
    web = await edge(dist, space.url),
    browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] }),
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: "dark",
      acceptDownloads: true,
    }),
    page = await context.newPage();
  const guard = guardCrashes(page);
  const shot = async (name: string, ids?: "space-id") => {
    await guard.check("before screenshot " + name, ids ? { idsOnPurpose: ids } : undefined);
    const out = process.env.VYRE_CONSOLE_SHOTS;
    if (out) {
      fs.mkdirSync(out, { recursive: true });
      await page.waitForFunction(() => document.querySelectorAll("[role=progressbar]").length === 0);
      await page.screenshot({ path: path.join(out, name) });
    }
  };
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error("Console page error", page.url(), error.message);
  });
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Console fixture owner");
    await page.getByTestId("claim-username").fill("consolefixture");
    await page.getByTestId("claim-password").fill("fixture password 123");
    await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click();
    await page.getByTestId("claim-saved").click();
    await page.getByTestId("claim-create").click();
    await dismissOnboarding(page);
    await page.getByTestId("shell").waitFor({ timeout: 30000 });
    // the Console as people really reach it: at its own address, console.<name>.<zone>, where it is drawn alone (src/shell/console-host.ts: a host whose first label is console and that has a third label). *.localhost resolves to this machine in Chrome. The owner session is carried over to that origin as the same sign-in.
    const consoleOrigin = web.origin.replace(new URL(web.origin).hostname, "console.fixture.localhost");
    assert.ok(isConsoleHost(new URL(consoleOrigin).hostname), "the walk reaches the Console under a console. host");
    const session = await page.evaluate(() => localStorage.getItem("vyre.session.v1")!);
    await page.goto(`${consoleOrigin}/`, { waitUntil: "load" });
    await page.evaluate(
      (json) => localStorage.setItem("vyre.session.v1", json),
      session.replaceAll(web.origin, consoleOrigin),
    );
    await page.goto(`${consoleOrigin}/console`, { waitUntil: "load" });
    await page.getByTestId("console").waitFor({ timeout: 30000 });
    // the export is real; only the two counts the screen reads are put on its answer, as a Space with unfetchable Drive files would give them
    let counts: { leftOut: number; filesKept: number } = { leftOut: 2, filesKept: 5 };
    await page.route("**/v1/backup/export_status*", async (route) => {
      const res = await route.fetch();
      const json = await res.json();
      if (json?.data) json.data = { ...json.data, ...counts };
      await route.fulfill({ response: res, json });
    });
    const dir = process.env["VYRE_FILES_SHOTS"] ?? "/tmp/vyre-export-shots";
    fs.mkdirSync(dir, { recursive: true });
    const take = async (tag: string, kept: number): Promise<void> => {
      counts = { leftOut: kept === 0 ? 3 : 2, filesKept: kept };
      await page.emulateMedia({ colorScheme: "dark" });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${consoleOrigin}/console`, { waitUntil: "load" });
      await page.getByTestId("console").waitFor({ timeout: 30000 });
      await openConsolePage(page, "export");
      await page.getByTestId("console-export").waitFor();
      await page.getByTestId("export-all-start").click();
      await page
        .getByText(/left out/)
        .first()
        .waitFor({ timeout: 60000 });
      const text = await page.getByTestId("console-export").innerText();
      assert.match(text, kept === 0 ? /Every file was left out/ : /2 files were left out/);
      assert.match(text, /NOT-EXPORTED\.txt/);
      await page.screenshot({ path: path.join(dir, `export-${tag}-desktop-dark.png`) });
      // the same screen on a phone, light (the Console's own list of places is not walked on a phone; the page is already open)
      await page.emulateMedia({ colorScheme: "light" });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(dir, `export-${tag}-phone-light.png`) });
    };
    await take("some-left-out", 5);
    await take("every-file-left-out", 0);
  } finally {
    await context.close();
    await browser.close();
    web.close();
    await space.stop();
    fs.rmSync(space.dir, { recursive: true, force: true });
  }
});
