// b-chat2: Rewind (icon, menu, card, folded row, Undo), the plan card and the island in the real app (the conversation mount over the sample), dark desktop 1440 and light phone 390. Run on the box:
//   CHROME_BIN=<chrome-headless-shell> node scripts/shots/b-chat2-shoot.mjs [out-dir] [--skip-export]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-b-chat2/shots";
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
const browser = await chromium.launch({
  args: ["--no-sandbox"],
  ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
});
const SCENES = [
  ["graphite", "desk", 1440, 900],
  ["paper", "phone", 390, 844],
];
const log = [];
const say = (...a) => {
  log.push(a.join(" "));
  console.log(...a);
};
for (const [skin, size, w, h] of SCENES) {
  const tag = `${skin}-${size}`;
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
    colorScheme: skin === "graphite" ? "dark" : "light",
    reducedMotion: "reduce",
    hasTouch: size === "phone",
  });
  const page = await ctx.newPage();
  const go = async (v) => {
    const url = routeUrl(real.origin, `/m/P-L9b_04?v=${v}`, skin);
    await page.goto(url, { waitUntil: "load", timeout: 60000 }).catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
    await page.waitForSelector("[data-testid=composer-field]", { timeout: 20000 }).catch(() => say(tag, "missing composer", v));
    await page.waitForTimeout(1000);
  };
  const shot = async (n) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, `${n}-${tag}.png`) });
  };
  const count = (tid) => page.locator(`[data-testid^='${tid}']`).count();
  // ---- rewind
  await go("idle");
  const row = page.locator("[data-testid=msg-m3]").first();
  if (size === "desk") {
    await row.hover();
    await shot("rw1-hover");
    say(tag, "rewind icon on my message:", await count("act-rewind-m3"));
    await page.locator("[data-testid=act-more-m3]").first().click();
    await shot("rw2-menu");
    await page.keyboard.press("Escape");
    await row.hover();
    await page.locator("[data-testid=act-rewind-m3]").first().click();
  } else {
    // a finger has no hover: a long press opens the message's sheet (Rewind to here is in it); the /rewind command opens the same card
    const bb = await row.boundingBox();
    if (bb) {
      await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(900);
      await page.mouse.up();
    }
    await shot("rw2-menu");
    const entry = page.getByText("Rewind to here").first();
    if (await entry.count()) await entry.click({ timeout: 5000 }).catch(() => undefined);
    if (!(await count("rewind-card"))) {
      say(tag, "sheet did not open on a long press; using /rewind");
      await page.keyboard.press("Escape").catch(() => undefined);
      await page.locator("[data-testid=composer-field]").first().click();
      await page.keyboard.type("/rewind");
      await page.waitForTimeout(300);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
      if (!(await count("rewind-card"))) await page.keyboard.press("Enter");
    }
  }
  await page.waitForSelector("[data-testid=rewind-card]", { timeout: 8000 }).catch(() => say(tag, "no rewind card"));
  await shot("rw3-card");
  await page.locator("[data-testid=rewind-go]").first().click({ timeout: 8000 }).catch(() => say(tag, "no Go back"));
  await page.waitForTimeout(800);
  say(tag, "folded rows:", await count("folded-"));
  await shot("rw4-folded");
  await page.locator("[data-testid^='folded-'][data-testid$='-toggle']").first().click().catch(() => say(tag, "no toggle"));
  await shot("rw5-opened");
  await page.locator("[data-testid^='folded-'][data-testid$='-undo']").first().click().catch(() => say(tag, "no undo"));
  await page.waitForTimeout(800);
  say(tag, "folded rows after Undo:", await count("folded-"));
  await shot("rw6-undone");
  // ---- the plan card
  await go("plan");
  await page.waitForSelector("[data-testid^='blk-plan-']", { timeout: 8000 }).catch(() => say(tag, "no plan card"));
  await shot("plan1-card");
  await page.locator("[data-testid^='blk-plan-'][data-testid$='-edit']").first().click().catch(() => say(tag, "no Change it"));
  await page.waitForTimeout(600);
  say(tag, "draft after Change it:", JSON.stringify((await page.locator("[data-testid=composer-field]").first().inputValue().catch(() => "")).slice(0, 80)));
  await shot("plan2-changed");
  // ---- the island
  for (const v of ["streaming", "busy"]) {
    await go(v);
    say(tag, v, "island:", await count("work-island"), "crew island:", await count("crew-island"), "text:", await page.locator("[data-testid=work-island-text]").first().innerText().catch(() => "-"));
    await shot(`island-${v}`);
  }
  await ctx.close();
}
await browser.close();
real.close?.();
fs.writeFileSync(path.join(out, "log.txt"), log.join("\n"));
