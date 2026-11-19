// Pictures of the helper tiles (TILES_01) from the real components: export the shots app once, serve it, shoot paper and graphite at the wide size and the phone size, then click the switch and shoot the rows.
// Run on the build box from the worktree:  node scripts/shots/tiles-shoot.mjs [out-dir] [--skip-export]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl, loadTargets } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-r42-subagents/shots";
if (!args.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync((await import(path.join(REPO, "scripts/shots/expo-cmd.mjs"))).exportCmd(REPO), {
    cwd: appDir,
    stdio: "inherit",
    env: exportEnv(),
  });
}
fs.mkdirSync(out, { recursive: true });
const SIZES = { wide: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const targets = loadTargets(path.join(REPO, "scripts/shots")).filter((t) =>
  /^(TILES_01|PEEKTABS_01|RUNVIEWS_01|PEEKRESULT_01|RUNSECTION_01)/.test(t.id),
);
const report = [];
for (const t of targets)
  for (const skin of ["paper", "graphite"])
    for (const [size, vp] of Object.entries(SIZES)) {
      const ctx = await browser.newContext({
        viewport: vp,
        deviceScaleFactor: 1,
        colorScheme: skin === "graphite" ? "dark" : "light",
        reducedMotion: "reduce",
      });
      const page = await ctx.newPage();
      const errs = [];
      page.on("pageerror", (e) => errs.push(String(e)));
      const url = routeUrl(real.origin, t.route, skin);
      await page
        .goto(url, { waitUntil: "load", timeout: 60000 })
        .catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
      let found = true;
      await page.waitForSelector(t.waitFor, { timeout: 8000 }).catch(() => (found = false));
      await page.waitForTimeout(900);
      const tiles = await page.locator("[data-testid='crew-tiles']").count();
      const sw = await page.locator("[data-testid='crew-strip-view']").count();
      const over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      const file = path.join(
        out,
        `${t.id.replace(/^(TILES_01|PEEKTABS_01|RUNVIEWS_01|PEEKRESULT_01|RUNSECTION_01)-/, "")}-${skin}-${size}.png`,
      );
      await page.screenshot({ path: file });
      report.push({
        file: path.basename(file),
        found,
        tiles,
        switchShown: sw,
        overflowX: over,
        errs: errs.slice(0, 2),
      });
      // the Crew pane's three tabs: shoot each
      if (t.id.startsWith("RUNSECTION_01")) {
        await page.waitForSelector("[data-testid='crew-tab-tab-board']", { timeout: 8000 }).catch(() => undefined);
        await page.waitForTimeout(500);
        await page.screenshot({ path: file.replace(".png", "-helpers.png") });
        report.push({
          file: path.basename(file) + " helpers",
          tabs: await page.locator("[data-testid^='crew-tab-tab-']").count(),
          activity: await page.locator("[data-testid='activity']").count(),
        });
        for (const tab of ["board", "tokens"]) {
          await page.click(`[data-testid='crew-tab-tab-${tab}']`);
          await page.waitForTimeout(400);
          if (tab === "tokens") await page.click("[data-testid='token-report-line']").catch(() => undefined);
          await page.waitForTimeout(200);
          await page.screenshot({ path: file.replace(".png", `-${tab}.png`) });
          report.push({
            file: path.basename(file) + " " + tab,
            board: await page.locator("[data-testid='board']").count(),
            messages: await page.locator("[data-testid='message-lines']").count(),
            tokens: await page.locator("[data-testid='token-report']").count(),
          });
        }
      }
      // a finished result: press each action, shoot the sheet it opens, close it
      if (t.id.startsWith("PEEKRESULT_01")) {
        for (const [act, close] of [
          ["crew-result-task", "crew-result-task-cancel"],
          ["crew-result-file", "folder-move-cancel"],
          ["crew-result-record", "record-picker-cancel"],
        ]) {
          await page.click(`[data-testid='${act}']`);
          await page.waitForTimeout(500);
          await page.screenshot({ path: file.replace(".png", `-${act.replace("crew-result-", "")}.png`) });
          const opened = await page.locator(`[data-testid='${close}']`).count();
          report.push({ file: path.basename(file) + " " + act, closeControlShown: opened });
          await page.click(`[data-testid='${close}']`);
          await page.waitForTimeout(300);
        }
      }
      // a helper's session: press each tab and shoot it
      if (t.id.startsWith("PEEKTABS_01")) {
        for (const tab of ["files", "details"]) {
          await page.click(`[data-testid='crew-peek-tab-${tab}']`);
          await page.waitForTimeout(300);
          await page.screenshot({ path: file.replace(".png", `-${tab}.png`) });
          const open = await page.evaluate(() =>
            ["transcript", "files", "details"].map((x) => {
              const e = document.querySelector(`[data-testid='crew-peek-panel-${x}']`);
              return e && getComputedStyle(e).display !== "none" ? x : "";
            }),
          );
          report.push({ file: path.basename(file) + " " + tab, panelsShown: open.filter(Boolean) });
        }
      }
      // a tile that waits on a held request: Allow and Deny are there for the person who may answer it
      if (t.id.endsWith("-tiles") && size === "wide") {
        const allow = await page.locator("[data-testid='crew-tile-sub_b-allow']").count();
        const deny = await page.locator("[data-testid='crew-tile-sub_b-deny']").count();
        report.push({ file: path.basename(file) + " needs-you tile", allow, deny });
        if (allow > 0) {
          await page.click("[data-testid='crew-tile-sub_b-deny']");
          await page.waitForTimeout(300);
          await page.screenshot({ path: file.replace(".png", "-deny.png") });
        }
      }
      // the switch: tiles to rows and back on the same page
      if (t.id.endsWith("-tiles") && sw > 0) {
        await page.click("[data-testid='crew-strip-view']");
        await page.waitForTimeout(300);
        const asRows = await page.locator("[data-testid='crew-tiles']").count();
        await page.screenshot({ path: file.replace(".png", "-switched.png") });
        await page.click("[data-testid='crew-strip-view']");
        await page.waitForTimeout(300);
        const back = await page.locator("[data-testid='crew-tiles']").count();
        report.push({ file: path.basename(file) + " switch", tilesAfterSwitch: asRows, tilesAfterSecondPress: back });
      }
      await ctx.close();
    }
// the needs-you tile in every skin: the amber ground comes from the skin's own warn colour, so each one shows it
const ALL = [
  "vyre-black",
  "graphite",
  "obsidian",
  "charcoal",
  "slate",
  "ember",
  "moss",
  "dusk",
  "vyre-light",
  "paper",
  "fog",
  "linen",
];
for (const skin of ALL) {
  const ctx = await browser.newContext({ viewport: SIZES.wide, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(routeUrl(real.origin, "/m/TILES_01", skin), { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector("[data-testid='crew-tile-sub_b-allow']", { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(500);
  const tile = page.locator("[data-testid='crew-tile-sub_b']");
  if ((await tile.count()) > 0) await tile.screenshot({ path: path.join(out, `needs-${skin}.png`) });
  report.push({
    file: `needs-${skin}.png`,
    shadow: (await tile.count()) > 0 ? await tile.evaluate((e) => getComputedStyle(e).boxShadow.slice(0, 60)) : null,
  });
  await ctx.close();
}
console.log(JSON.stringify(report, null, 1));
await browser.close();
real.close();
process.exit(0);
