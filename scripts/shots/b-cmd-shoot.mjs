// b-cmd: the Command card and a command's one-line result in the real app (the conversation mount over the sample), dark and light. Run on the box:
//   CHROME_BIN=<chrome-headless-shell> node scripts/shots/b-cmd-shoot.mjs [out-dir] [--skip-export]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-b-cmd/shots";
if (!args.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync((await import(path.join(REPO, "scripts/shots/expo-cmd.mjs"))).exportCmd(REPO), {
    cwd: appDir,
    stdio: "inherit",
    env: exportEnv(),
  });
}
fs.mkdirSync(out, { recursive: true });
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"], ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) });
const SIZES = { w1440: [1440, 900], w900: [900, 800] };
const log = [];
const say = (...a) => {
  log.push(a.join(" "));
  console.log(...a);
};
for (const skin of ["graphite", "paper"])
  for (const [size, [w, h]] of Object.entries(SIZES)) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: 1,
      colorScheme: skin === "graphite" ? "dark" : "light",
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    const tag = `${skin}-${size}`;
    const go = async (v) => {
      const url = routeUrl(real.origin, `/m/P-L9b_04?v=${v}`, skin);
      await page
        .goto(url, { waitUntil: "load", timeout: 60000 })
        .catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
      await page
        .waitForSelector("[data-testid=composer-field]", { timeout: 20000 })
        .catch(() => say("missing composer", v));
      await page.waitForTimeout(1000);
    };
    const shot = async (name) => {
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(out, `${name}-${tag}.png`) });
    };
    const run = async (cmd) => {
      await page.locator("[data-testid=composer-field]").first().click();
      await page.keyboard.type(cmd);
      await page.waitForTimeout(250);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(250);
      // a menu pick leaves the command in the field: Enter again sends it
      if (
        (await page
          .locator("[data-testid=composer-field]")
          .first()
          .inputValue()
          .catch(() => "")) !== ""
      )
        await page.keyboard.press("Enter");
      await page.waitForTimeout(500);
    };
    const geo = async (t) => {
      const g = await page.evaluate(() => {
        const q = (id) => document.querySelector(`[data-testid=${id}]`)?.getBoundingClientRect();
        const c = q("composer"),
          k = q("command-card");
        const f = document.activeElement?.getAttribute?.("data-testid");
        return {
          composer: c && [Math.round(c.left), Math.round(c.width)],
          card: k && [Math.round(k.left), Math.round(k.width), Math.round(k.bottom), Math.round(k.height)],
          composerTop: c && Math.round(c.top),
          focus: f,
        };
      });
      say(tag, t, JSON.stringify(g));
    };
    // usage: ready, models open, after Escape
    await go("cmd");
    await run("/usage");
    await page.waitForSelector("[data-testid=command-card]", { timeout: 8000 }).catch(() => say(tag, "no usage card"));
    await shot("1-usage");
    await geo("usage");
    await page
      .locator("[data-testid='row-cmd-account-Claude sign-in']")
      .first()
      .click()
      .catch((e) => say(tag, "row click", String(e).slice(0, 80)));
    await shot("2-models-open");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    say(
      tag,
      "card after Escape:",
      await page.locator("[data-testid=command-card]").count(),
      "focus:",
      await page.evaluate(() => document.activeElement?.getAttribute?.("data-testid")),
    );
    await shot("3-after-esc");
    // permissions, take back
    await run("/permissions");
    await page
      .waitForSelector("[data-testid=command-card]", { timeout: 8000 })
      .catch(() => say(tag, "no permissions card"));
    await shot("7-permissions");
    await page
      .locator("[data-testid=cmd-take-rul_2]")
      .first()
      .click()
      .catch((e) => say(tag, "take", String(e).slice(0, 80)));
    await page.waitForTimeout(500);
    await shot("8-take-back");
    say(
      tag,
      "notice:",
      JSON.stringify(await page.locator("[data-testid=notice-text]").allTextContents()),
      "action:",
      JSON.stringify(await page.locator("[data-testid=notice-action]").allTextContents()),
    );
    // one-line results
    await run("/plan on");
    await shot("9-plan-notice");
    await run("/pin");
    await shot("11-pin-notice");
    say(tag, "above composer after /pin:", await page.locator("[data-testid=conversation-line]").count());
    // /model: the composer's own menu
    await run("/model");
    await page.waitForTimeout(400);
    say(tag, "composer panel open:", await page.locator("[data-testid=composer-panel]").count());
    await shot("10-picker-model");
    await page.keyboard.press("Escape");
    await ctx.close();
    // loading, failed, empty
    for (const [v, name] of [
      ["cmdslow", "4-loading"],
      ["cmdfail", "5-failed"],
      ["cmdempty", "6-empty"],
    ]) {
      const c2 = await browser.newContext({
        viewport: { width: w, height: h },
        deviceScaleFactor: 1,
        colorScheme: skin === "graphite" ? "dark" : "light",
        reducedMotion: "reduce",
      });
      const p2 = await c2.newPage();
      const url = routeUrl(real.origin, `/m/P-L9b_04?v=${v}`, skin);
      await p2
        .goto(url, { waitUntil: "load", timeout: 60000 })
        .catch(() => p2.goto(url, { waitUntil: "load", timeout: 60000 }));
      await p2.waitForSelector("[data-testid=composer-field]", { timeout: 20000 });
      await p2.waitForTimeout(800);
      await p2.locator("[data-testid=composer-field]").first().click();
      await p2.keyboard.type("/usage");
      await p2.waitForTimeout(250);
      await p2.keyboard.press("Enter");
      await p2.waitForTimeout(250);
      if (
        (await p2
          .locator("[data-testid=composer-field]")
          .first()
          .inputValue()
          .catch(() => "")) !== ""
      )
        await p2.keyboard.press("Enter");
      await p2.waitForTimeout(v === "cmdslow" ? 900 : 700);
      await p2.screenshot({ path: path.join(out, `${name}-${tag}.png`) });
      say(
        tag,
        name,
        "card text:",
        JSON.stringify(
          (
            await p2
              .locator("[data-testid=command-card]")
              .first()
              .innerText()
              .catch(() => "none")
          ).slice(0, 160),
        ),
      );
      await c2.close();
    }
  }
fs.writeFileSync(path.join(out, "log.txt"), log.join("\n"));
await browser.close();
process.exit(0);
