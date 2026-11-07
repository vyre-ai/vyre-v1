// l-vaultdel: a sign-in's page in the Vault with its More menu, the Disconnect and Move to Trash confirms, Rename, and the list's right-click Move to Trash. Run on the box:
//   PLAYWRIGHT_BROWSERS_PATH=/var/lib/ci-run/ms-playwright node scripts/shots/l-vaultdel-shoot.mjs [out-dir] [--skip-export]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-l-vaultdel/shots";
if (!args.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync((await import(path.join(REPO, "scripts/shots/expo-cmd.mjs"))).exportCmd(REPO), { cwd: appDir, stdio: "inherit", env: exportEnv() });
}
fs.mkdirSync(out, { recursive: true });
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const SIZES = { wide: [1440, 900], phone: [390, 844] };
for (const skin of ["paper", "graphite"]) for (const [size, [w, h]] of Object.entries(SIZES)) {
  const open = async () => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
    const page = await ctx.newPage();
    const url = routeUrl(real.origin, "/m/P-L9f_05?view=providers", skin);
    await page.goto(url, { waitUntil: "load", timeout: 60000 }).catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
    await page.waitForSelector("[data-testid^=row-vit_prov], [data-testid^=row-vit_]", { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(800);
    if (!(await page.$("[data-testid=provider-page]"))) {
      const rows = await page.$$("[data-testid^=row-vit_]");
      for (const r of rows) { await r.click().catch(() => undefined); await page.waitForTimeout(400); if (await page.$("[data-testid=provider-page]")) break; }
    }
    await page.waitForSelector("[data-testid=provider-page]", { timeout: 8000 }).catch(() => console.log(skin, size, "no provider-page"));
    await page.waitForTimeout(600);
    return { ctx, page };
  };
  let { ctx, page } = await open();
  await page.screenshot({ path: path.join(out, `page-${skin}-${size}.png`) });
  await page.click("[data-testid=provider-more]").catch((e) => console.log("more", String(e).slice(0, 80)));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, `menu-${skin}-${size}.png`) });
  console.log(skin, size, "menu items", JSON.stringify(await page.$$eval("[data-testid^=menu-item-]", (n) => n.map((e) => e.getAttribute("data-testid").replace("menu-item-", "")))));
  await page.click("[data-testid='menu-item-Disconnect…']").catch(() => undefined);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, `disconnect-${skin}-${size}.png`) });
  await page.click("[data-testid=provider-confirm-no]").catch(() => undefined);
  await page.click("[data-testid=provider-more]").catch(() => undefined);
  await page.click("[data-testid='menu-item-Move to Trash']").catch(() => undefined);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, `trash-${skin}-${size}.png`) });
  await page.click("[data-testid=provider-confirm-yes]").catch(() => undefined);
  await page.waitForTimeout(600);
  console.log(skin, size, "after trash: provider-page", (await page.$$("[data-testid=provider-page]")).length, "line", JSON.stringify(await page.$$eval("[data-testid=vault-line]", (n) => n.map((e) => e.textContent))));
  await page.screenshot({ path: path.join(out, `trashed-${skin}-${size}.png`) });
  await ctx.close();
  ({ ctx, page } = await open());
  await page.click("[data-testid=provider-more]").catch(() => undefined);
  await page.click("[data-testid='menu-item-Rename…']").catch(() => undefined);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, `rename-${skin}-${size}.png`) });
  await ctx.close();
}
await browser.close(); real.close();
