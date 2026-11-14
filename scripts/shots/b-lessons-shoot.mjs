// Lane b-lessons, on the build box from a worktree: node scripts/shots/b-lessons-shoot.mjs <out-dir> <label> [--skip-export]
// The real app's LESSONS_01 mount (a long chat in which every reply used the same two lessons, and a chat that ends on the message that taught one) at 1440 wide and a phone, paper and graphite.
// <label> is "before" on the code without the change and "after" on the code with it; only "after" has the mark to press, so only it shoots the opened list.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const plain = args.filter((a) => !a.startsWith("--"));
const out = plain[0] || "/root/wt/tmp-b-lessons/shots";
const label = plain[1] || "after";
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
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const SIZES = { w1440: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
for (const skin of ["paper", "graphite"])
  for (const [size, vp] of Object.entries(SIZES))
    for (const part of ["chat", "fresh"]) {
      const ctx = await browser.newContext({
        viewport: vp,
        deviceScaleFactor: 1,
        colorScheme: skin === "graphite" ? "dark" : "light",
        reducedMotion: "reduce",
      });
      const page = await ctx.newPage();
      const errs = [];
      page.on("pageerror", (e) => errs.push(String(e)));
      await page.goto(routeUrl(real.origin, `/m/LESSONS_01?part=${part}`, skin), { waitUntil: "load", timeout: 60000 });
      await page.waitForSelector("[data-testid='conversation-feed']", { timeout: 30000 });
      await page.waitForTimeout(1800);
      const base = `${label}-${skin}-${size}-${part}`;
      await page.screenshot({ path: path.join(out, `${base}.png`) });
      console.log(base, errs.length ? `errors: ${errs.join(" | ")}` : "no page errors");
      if (label === "after" && part === "chat") {
        const marks = await page.$$("[data-testid^='lesson-mark-msg_L_a']");
        console.log(base, "reply marks:", marks.length);
        if (marks.length > 0) {
          await marks[marks.length - 1].click();
          await page.waitForSelector("[data-testid^='lesson-list-msg_L_a']", { timeout: 8000 });
          await page.waitForTimeout(300);
          await page.screenshot({ path: path.join(out, `${base}-open.png`) });
          const long = await page.$("[data-testid^='lesson-text-fct_les_looks']");
          if (long) {
            await long.click();
            await page.waitForTimeout(200);
            await page.screenshot({ path: path.join(out, `${base}-open-whole.png`) });
          }
          const rm = await page.$("[data-testid^='lesson-remove-fct_les_first']");
          if (rm) {
            await rm.click();
            await page.waitForTimeout(300);
            await page.screenshot({ path: path.join(out, `${base}-open-removed.png`) });
          }
          await page.keyboard.press("Escape");
          await page.waitForTimeout(200);
          const gone = (await page.$("[data-testid^='lesson-list-msg_L_a']")) === null;
          console.log(base, "Escape closes the list:", gone);
        }
        const mine = await page.$("[data-testid='lesson-mark-msg_L_p0']");
        if (mine) {
          await mine.click();
          await page.waitForSelector("[data-testid='lesson-list-msg_L_p0']", { timeout: 8000 });
          await page.waitForTimeout(300);
          await page.screenshot({ path: path.join(out, `${base}-open-learned.png`) });
        }
      }
      await ctx.close();
    }
// The click-through of the new controls, from a fresh page for each: a press must change something a person can see within 1.5 s (the no-dead-buttons rule), here on the controls of this change.
if (label === "after") {
  const seen = (page) =>
    page.evaluate(
      () =>
        document.body.innerText +
        "|" +
        document.querySelectorAll("[data-testid]").length +
        "|" +
        [...document.querySelectorAll("[data-testid^='lesson-row-']")]
          .map((r) => r.getBoundingClientRect().height)
          .join(","),
    );
  const steps = [
    ["chat", "mark on a reply opens the list", "[data-testid^='lesson-mark-msg_L_a']", null],
    [
      "chat",
      "words open the whole lesson",
      "[data-testid^='lesson-text-fct_les_looks']",
      "[data-testid^='lesson-mark-msg_L_a']",
    ],
    [
      "chat",
      "See closes the list and opens Knows",
      "[data-testid^='lesson-see-fct_les_looks']",
      "[data-testid^='lesson-mark-msg_L_a']",
    ],
    [
      "chat",
      "Remove turns the row into Removed. Undo",
      "[data-testid^='lesson-remove-fct_les_looks']",
      "[data-testid^='lesson-mark-msg_L_a']",
    ],
    [
      "chat",
      "a press outside closes the list",
      "[data-testid^='lesson-list-away-msg_L_a']",
      "[data-testid^='lesson-mark-msg_L_a']",
    ],
    ["fresh", "Undo on the Learned line", "[data-testid^='learned-undo-']", null],
    ["fresh", "See on the Learned line", "[data-testid^='learned-see-']", null],
  ];
  let dead = 0;
  for (const [part, name, target, first] of steps) {
    const ctx = await browser.newContext({ viewport: SIZES.w1440, colorScheme: "light", reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto(routeUrl(real.origin, `/m/LESSONS_01?part=${part}`, "paper"), {
      waitUntil: "load",
      timeout: 60000,
    });
    await page.waitForSelector("[data-testid='conversation-feed']", { timeout: 30000 });
    await page.waitForTimeout(1500);
    if (first) {
      const f = await page.$$(first);
      await f[f.length - 1].click();
      await page.waitForTimeout(400);
    }
    const els = await page.$$(target);
    const el = els[els.length - 1];
    if (!el) {
      console.log("DEAD (not found)", name);
      dead++;
      await ctx.close();
      continue;
    }
    const before = await seen(page);
    await el.click({ force: true });
    await page.waitForTimeout(900);
    const changed = (await seen(page)) !== before;
    console.log(changed ? "ok  " : "DEAD", name);
    if (!changed) dead++;
    await ctx.close();
  }
  console.log(dead === 0 ? "click-through: no dead controls" : `click-through: ${dead} dead`);
}
await browser.close();
real.close?.();
console.log("done", out);
