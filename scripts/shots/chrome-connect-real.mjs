#!/usr/bin/env node
// Vyre for Chrome connected to a Space through the REAL web app: production export of apps/app served in front of a booted daemon, the owner claimed through the claim link in a real Chromium that
// has the unpacked extension and no native host. The walk: the panel offers Connect a Space; the address opens the app's own /chrome/connect page (apps/app/src/chrome-connect) in a tab; one press
// there hands the bound code to the extension; the panel fills in by itself; Settings, Sign-in and devices lists "Chrome on this computer"; signing it out there ends the extension's link.
// Run on the build box from the worktree after `node scripts/app-export.mjs`:  node --import tsx scripts/shots/chrome-connect-real.mjs [--dist apps/app/dist] [--out shots-out/chrome-connect-real]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./lib.mjs";
import { bootFreshSpace, claimOnEdge, dismissOnboarding, edge } from "../../apps/app/tests/real-app-harness.test.ts";
import { findChromium, launch } from "../../apps/chrome/tests/e2e/rig.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = parseArgs(process.argv.slice(2));
const dist = path.resolve(REPO, args.dist || "apps/app/dist");
const out = path.resolve(REPO, args.out || "shots-out/chrome-connect-real");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const found = await findChromium();
if (!found) {
  console.log("FAIL no full Chromium here");
  process.exit(1);
}
let failed = 0;
const say = (ok, line) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${line}`);
  if (!ok) failed += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const space = await bootFreshSpace(undefined, true);
const web = await edge(dist, space.url);
const r = await launch(found, { noHost: true });
const errors = [];
try {
  const ctx = r.context;
  // the owner claims the Space in this very Chromium, so the app here is signed in
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(claimOnEdge(space.claim, web.origin), { waitUntil: "load", timeout: 60000 });
  await page.getByTestId("claim-name").fill("Olivia Owner");
  await page.getByTestId("claim-username").fill("olivia");
  await page.getByTestId("claim-password").fill("correct horse battery 9");
  await page.getByTestId("claim-confirm").fill("correct horse battery 9");
  await page.getByTestId("claim-next").click();
  await page.getByTestId("claim-create").click();
  await page.getByTestId("shell").waitFor({ timeout: 30000 });
  await dismissOnboarding(page).catch(() => false);
  say(true, "the owner is signed in to the real app in this Chromium");

  // the panel, as its own window beside the page
  const winId = await r.worker.evaluate(async () => {
    const c = globalThis.chrome;
    const [t] = await c.tabs.query({ active: true });
    return t.windowId;
  });
  const waiting = ctx.waitForEvent("page", { predicate: (p) => p.url().includes("/src/panel/panel.html") });
  await r.worker.evaluate(async (w) => {
    await globalThis.chrome.windows.create({
      url: `src/panel/panel.html?window=${w}`,
      type: "popup",
      width: 400,
      height: 760,
      focused: false,
    });
  }, winId);
  const panel = await waiting;
  await panel.setViewportSize({ width: 400, height: 760 });
  await panel.waitForSelector("#laddr");
  say(/Connect a Space/.test(await panel.innerText("#main")), "the panel offers Connect a Space");

  // the address opens the app's own page, which is the real /chrome/connect screen
  await panel.fill("#laddr", web.origin);
  const opened = ctx.waitForEvent("page", { predicate: (p) => p.url().startsWith(`${web.origin}/chrome/connect`) });
  await panel.click("text=Connect >> nth=-1");
  const tab = await opened;
  tab.on("pageerror", (e) => errors.push(e.message));
  await tab.getByTestId("chrome-connect").waitFor({ timeout: 30000 });
  say(true, "the real /chrome/connect page shows Connect");
  await tab.setViewportSize({ width: 1280, height: 800 });
  await tab.screenshot({ path: path.join(out, "1-space-page.png") });
  await panel.screenshot({ path: path.join(out, "1-panel-waiting.png") });
  await tab.getByTestId("chrome-connect").click();
  await tab
    .getByTestId("chrome-done")
    .waitFor({ timeout: 20000 })
    .then(
      () => say(true, "the page says Connected"),
      () => say(false, "the page says Connected"),
    );
  await tab.screenshot({ path: path.join(out, "2-space-page-connected.png") }).catch(() => {});
  await panel.waitForSelector("#q", { timeout: 20000 }).then(
    () => say(true, "the panel filled in by itself"),
    () => say(false, "the panel filled in by itself"),
  );
  await panel.screenshot({ path: path.join(out, "3-panel-connected.png") });
  const links = await r.worker.evaluate(async () => (await globalThis.chrome.storage.local.get("vyreLinks")).vyreLinks);
  say(
    Array.isArray(links) && links.length === 1 && links[0].address === web.origin,
    "the extension keeps one link, to this Space",
  );
  await sleep(2500);
  say(
    !ctx.pages().some((p) => p.url().startsWith(`${web.origin}/chrome/connect`) && !p.isClosed()),
    "the Connect tab closed itself",
  );

  // Settings, Sign-in and devices lists Chrome
  await page.bringToFront();
  await page.goto(`${web.origin}/settings?skin=paper#screen=settings.page&page=signin`, {
    waitUntil: "load",
    timeout: 60000,
  });
  await page
    .getByText("Chrome on this computer")
    .first()
    .waitFor({ timeout: 20000 })
    .then(
      () => say(true, "Settings, Sign-in and devices lists Chrome on this computer"),
      () => say(false, "Settings, Sign-in and devices lists Chrome on this computer"),
    );
  await page.screenshot({ path: path.join(out, "4-settings-devices.png") });

  // signing it out there ends the extension's link: the Space closes its socket at its next check and the extension forgets the session
  await page
    .getByText("Chrome on this computer")
    .first()
    .locator("xpath=ancestor::*[.//button or .//*[@role='button']][1]")
    .getByText("Sign out")
    .first()
    .click();
  await page.getByText("Sign it out").first().click({ timeout: 5000 });
  let gone = false;
  for (let i = 0; i < 90 && !gone; i++) {
    await sleep(500);
    const l = await r.worker.evaluate(async () => (await globalThis.chrome.storage.local.get("vyreLinks")).vyreLinks);
    gone = !l || l.length === 0;
  }
  say(gone, "signed out in Settings: the extension forgot the link");
  await page.screenshot({ path: path.join(out, "5-settings-signed-out.png") });
  await panel.reload();
  await panel.waitForSelector("#laddr", { timeout: 20000 }).then(
    () => say(true, "the panel offers Connect a Space again"),
    () => say(false, "the panel offers Connect a Space again"),
  );
  await panel.screenshot({ path: path.join(out, "6-panel-signed-out.png") });
} catch (e) {
  say(false, `walk stopped: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  say(errors.length === 0, `no page errors (${errors.slice(0, 2).join(" | ")})`);
  await r.close().catch(() => {});
  await web.close?.();
  await space.stop?.();
}
console.log(failed ? `${failed} FAILED` : "all ok");
process.exit(failed ? 1 : 0);
