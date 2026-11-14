// b-connect lane pictures: the connect card in every state, from the real component after real presses, in paper and graphite at 1440 and 390. Run on the build box from the worktree:
//   node scripts/shots/connect-shoot.mjs [out-dir] [--skip-export] [--only=ask,wrong]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-b-connect/shots";
const only = (args.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").filter(Boolean);
if (!args.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync((await import(path.join(REPO, "scripts/shots/expo-cmd.mjs"))).exportCmd(REPO), {
    cwd: appDir,
    stdio: "inherit",
    env: exportEnv(),
  });
}
fs.mkdirSync(out, { recursive: true });
const SIZES = { 1440: { width: 1440, height: 900 }, 390: { width: 390, height: 844 } };
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const KEY = "fth_live_4f81c2a9d0";
const id = (s) => `[data-testid='connect-vrq_1${s}']`;
/** What a person does before the picture is taken. */
const STEPS = {
  ask: [],
  menu: [["click", id("-kept")]],
  working: [
    ["fill", id("-api_key-input"), KEY],
    ["click", id("-connect")],
    ["wait", 700],
  ],
  done: [
    ["fill", id("-api_key-input"), KEY],
    ["click", id("-connect")],
    ["wait", 1800],
  ],
  doneopen: [
    ["fill", id("-api_key-input"), KEY],
    ["click", id("-connect")],
    ["wait", 1800],
    ["click", id("-row")],
  ],
  wrong: [
    ["fill", id("-api_key-input"), "bad-4f81c2a9d0"],
    ["click", id("-connect")],
    ["wait", 900],
  ],
  have: [],
  admin: [],
  asked: [],
  later: [],
  offline: [
    ["fill", id("-api_key-input"), KEY],
    ["click", id("-connect")],
    ["wait", 900],
  ],
};
const parts = Object.keys(STEPS).filter((p) => only.length === 0 || only.includes(p));
for (const part of parts)
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
      const url = routeUrl(real.origin, `/m/CONNECTCARD_01?part=${part}`, skin);
      await page
        .goto(url, { waitUntil: "load", timeout: 60000 })
        .catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
      let found = true;
      await page.waitForSelector("[data-testid^='connect-vrq_1']", { timeout: 15000 }).catch(() => {
        found = false;
      });
      await page.waitForTimeout(400);
      for (const [op, sel, val] of STEPS[part]) {
        if (op === "wait") await page.waitForTimeout(sel);
        else if (op === "fill") await page.fill(sel, val).catch(() => (found = false));
        else if (op === "click") await page.click(sel).catch(() => (found = false));
        await page.waitForTimeout(150);
      }
      await page.waitForTimeout(400);
      const file = path.join(out, `${part}-${skin === "graphite" ? "dark" : "light"}-${size}.png`);
      await page.screenshot({ path: file });
      console.log(
        `shot ${path.basename(file)} steps=${found}${errs.length ? " errors=" + errs.join(" | ").slice(0, 300) : ""}`,
      );
      await ctx.close();
    }
// the keyboard: Tab walks every control in order, Enter on Kept in opens the menu, the arrows move, Escape closes and puts focus back, Enter in a field connects
if (only.length === 0 || only.includes("keys")) {
  const ctx = await browser.newContext({ viewport: SIZES[1440], colorScheme: "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(routeUrl(real.origin, "/m/CONNECTCARD_01?part=ask", "paper"), { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector("[data-testid^='connect-vrq_1']", { timeout: 15000 });
  const seen = [];
  const label = () =>
    page.evaluate(() => {
      const a = document.activeElement;
      return a ? a.getAttribute("data-testid") || a.getAttribute("aria-label") || a.tagName : "none";
    });
  await page.click("[data-testid='connect-vrq_1-api_key-label']").catch(() => undefined);
  await page.focus("[data-testid='connect-vrq_1-find']").catch(() => undefined);
  seen.push(await label());
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press("Tab");
    seen.push(await label());
  }
  console.log("TAB ORDER:", JSON.stringify(seen));
  await page.focus("[data-testid='connect-vrq_1-kept']");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  const open = await page.evaluate(() => !!document.querySelector("[role='menu']"));
  const first = await label();
  await page.keyboard.press("ArrowDown");
  const second = await label();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const closed = await page.evaluate(() => !document.querySelector("[role='menu']"));
  console.log("MENU:", JSON.stringify({ open, first, second, closed, back: await label() }));
  await page.fill("[data-testid='connect-vrq_1-api_key-input']", "fth_live_4f81c2a9d0");
  await page.focus("[data-testid='connect-vrq_1-api_key-input']");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1800);
  console.log(
    "ENTER CONNECTS:",
    await page.evaluate(() => !!document.querySelector("[data-testid='connect-vrq_1-row']")),
  );
  await ctx.close();
}
await browser.close();
real.close();
process.exit(0);
