// chat-frame: the head, the head menu, a message menu, the plus menu, the "/" list and the pane in the real Chats place (the CHATFRAME_01 mount), dark and light, 1440 and phone width. On the box:
//   CHROME_BIN=<chrome-headless-shell> node scripts/shots/chatframe-shoot.mjs [out-dir] [--skip-export]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-chat-frame/shots";
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
const SIZES = { w1440: [1440, 900], phone: [390, 844] };
for (const skin of ["graphite", "paper"])
  for (const [size, [w, h]] of Object.entries(SIZES)) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: 1,
      colorScheme: skin === "graphite" ? "dark" : "light",
      reducedMotion: "reduce",
      ...(size === "phone" ? { hasTouch: true, isMobile: true } : {}),
    });
    const page = await ctx.newPage();
    const tag = `${skin}-${size}`;
    const go = async (q = "") => {
      const url = routeUrl(real.origin, `/m/CHATFRAME_01${q}`, skin);
      await page
        .goto(url, { waitUntil: "load", timeout: 60000 })
        .catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
      await page
        .waitForSelector("[data-testid=composer-field]", { timeout: 20000 })
        .catch(() => console.log("missing composer", tag));
      await page.waitForTimeout(900);
    };
    const shot = async (name) => {
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(out, `${name}-${tag}.png`) });
    };
    const click = (sel) =>
      page
        .locator(sel)
        .first()
        .click({ timeout: 4000 })
        .catch((e) => console.log(tag, "no", sel, String(e).slice(0, 60)));
    await go();
    await shot("1-chat-pane-agent");
    await click("[data-testid=more-button]");
    await shot("2-head-menu");
    await page.keyboard.press("Escape");
    await click("[data-testid=composer-attach]");
    await shot("3-plus-menu");
    await page.keyboard.press("Escape");
    await page
      .locator("[data-testid=composer-field]")
      .first()
      .click()
      .catch(() => undefined);
    await page.keyboard.type("/");
    await page.waitForTimeout(400);
    await shot("4-slash-list");
    await page.keyboard.press("Escape");
    await page
      .locator("[data-testid=composer-field]")
      .first()
      .fill("")
      .catch(() => undefined);
    // a message menu: by hover and More on a desktop; by a long press on a phone (no hover there), then More inside the sheet
    const body = page.locator("[data-testid^=body-]").first();
    if (size === "phone") {
      const press = async (loc) => {
        await loc.dispatchEvent("touchstart", {}).catch(() => console.log(tag, "no row to press"));
        await page.waitForTimeout(600);
      };
      await press(body);
      await shot("5-message-menu");
      // the rest of the list is in the same sheet: scroll it to the end
      await page.evaluate(() => {
        const d = document.querySelector("[role=dialog]");
        d?.querySelectorAll("*").forEach((n) => {
          if (n.scrollHeight > n.clientHeight + 4) n.scrollTop = n.scrollHeight;
        });
      });
      await shot("5b-message-more");
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "Done" })
        .first()
        .click({ timeout: 2000 })
        .catch(() => undefined);
      await press(page.getByText("Book 2pm.").first());
      await shot("5c-own-message-sheet");
      await page.keyboard.press("Escape");
    } else {
      await body.hover().catch(() => undefined);
      await page
        .locator("[data-testid^=act-more-]")
        .first()
        .click({ timeout: 3000, force: true })
        .catch(() => console.log(tag, "no message more"));
      await shot("5-message-menu");
      await page.keyboard.press("Escape");
    }
    // two agents working: the composer's stop offers one per face and Stop everyone
    await go("?busy=1");
    await click("[data-testid=composer-send]");
    await shot("8-stop-menu");
    await page.keyboard.press("Escape");
    if (size === "w1440") {
      await go("?kind=channel");
      await shot("6-pane-channel");
      await go("?kind=dm");
      await shot("7-pane-dm");
    }
    await ctx.close();
  }
await browser.close();
real.close?.();
console.log("done", out);
