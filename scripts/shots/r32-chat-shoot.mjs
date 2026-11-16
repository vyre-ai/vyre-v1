// r32-chat: the pictures of the rows this lane closes, in the real chat over the sample Space (CHATFRAME_01) and the plain question (R32CHAT_01), dark and light, at 1440, 1024 and 390 wide. On the box:
//   CHROME_BIN=<chrome-headless-shell> node scripts/shots/r32-chat-shoot.mjs [out-dir] [--skip-export]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-r32-chat/shots";
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
const SIZES = { w1440: [1440, 900], w1024: [1024, 768], w640: [640, 800], phone: [390, 844] };
const PARTS = (process.env.R32_PARTS ?? "menu,work,plain").split(",");
const report = [];
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
    const go = async (route) => {
      const url = routeUrl(real.origin, route, skin);
      await page
        .goto(url, { waitUntil: "load", timeout: 60000 })
        .catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
      await page.waitForSelector("[data-testid=composer-field]", { timeout: 20000 }).catch(() => undefined);
      await page.waitForTimeout(900);
    };
    const shot = async (name) => {
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(out, `${name}-${tag}.png`) });
    };
    // G-menu: the message menu opened at the pointer flips left at the right edge and up near the bottom
    await go("/m/CHATFRAME_01");
    if (size !== "phone" && PARTS.includes("menu")) {
      await page.keyboard.press("Control+\\"); // close the pane: the column reaches the window's edge
      await page.waitForTimeout(600);
      const rows = page.locator("[data-testid^=msg-]");
      const n = await rows.count();
      const boxOf = async (i) => (await rows.nth(i).boundingBox()) ?? { x: 0, y: 200, width: w, height: 40 };
      const menuBox = async (label) => {
        const m = page.getByTestId("menu");
        const ok = await m.waitFor({ timeout: 4000 }).then(() => true, () => false);
        if (!ok) {
          report.push(`${tag} ${label}: no menu opened`);
          return null;
        }
        return m.boundingBox();
      };
      // right edge: the right end of my own message ("Book 2pm."), the pointer 8 px inside its right edge
      const mine = page.locator("[data-testid^=body-], [data-testid^=msg-]").filter({ hasText: "Book 2pm." }).last();
      const mb = (await mine.boundingBox()) ?? { x: w - 300, y: 300, width: 200, height: 30 };
      await page.mouse.click(Math.round(mb.x + mb.width - 8), Math.round(mb.y + mb.height / 2), { button: "right" });
      const m1 = await menuBox("right edge");
      await shot("menu-flip-left");
      if (m1) report.push(`${tag} right edge: pointer ${Math.round(mb.x + mb.width - 8)}, menu x ${Math.round(m1.x)} to ${Math.round(m1.x + m1.width)} of ${w}`);
      await page.keyboard.press("Escape");
      // bottom: the last message, the pointer low in the window
      const last = await boxOf(n - 1);
      await page.mouse.click(Math.round(w / 2), Math.min(last.y + Math.min(12, last.height / 2), h - 90), { button: "right" });
      const m2 = await menuBox("bottom");
      await shot("menu-flip-up");
      if (m2) report.push(`${tag} bottom: menu y ${Math.round(m2.y)} to ${Math.round(m2.y + m2.height)} of ${h}`);
      await page.keyboard.press("Escape");
      await go("/m/CHATFRAME_01");
    }
    // the work line under a finished reply opens to its steps and each step to what it did
    if (!PARTS.includes("work")) {
      await ctx.close();
      continue;
    }
    const fold = page.locator("[data-testid^=work-]").first();
    await fold
      .getByRole("button")
      .first()
      .click({ timeout: 4000 })
      .catch(() => report.push(`${tag} no work line`));
    await shot("work-open");
    const step = page.locator("[data-testid^=step-]").filter({ hasNotText: "zzzz" }).first();
    await step
      .getByRole("button")
      .first()
      .click({ timeout: 4000 })
      .catch(() => report.push(`${tag} no step`));
    await shot("work-step-open");
    const did = await page
      .locator("[data-testid^=step-did-]")
      .first()
      .innerText()
      .catch(() => "");
    report.push(`${tag} step says: ${did}`);
    // G55 the thread's decision; G4 Rewind in the head menu; G67 a failed row's menu has Dismiss
    if (PARTS.includes("rows")) {
      await go("/m/R32CHAT_01?part=decided");
      await page.waitForSelector("[data-testid=thread-decided]", { timeout: 8000 }).catch(() => report.push(`${tag} no decided line`));
      await shot("G55-thread-decided");
      await go("/m/CHATFRAME_01");
      await page.locator("[data-testid=more-button]").first().click({ timeout: 4000 }).catch(() => report.push(`${tag} no head menu`));
      await shot("G4-head-menu-rewind");
      await page.keyboard.press("Escape");
      await go("/m/CARDS_01?part=err");
      await page.waitForSelector("[data-testid=err-more]", { timeout: 8000 }).catch(() => report.push(`${tag} no error card`));
      await page.getByTestId("err-more").click({ timeout: 3000 }).catch(() => undefined);
      await shot("G67-error-row-menu");
      await page.keyboard.press("Escape");
    }
    // a teammate's plain question
    await go("/m/R32CHAT_01?part=ask");
    await page
      .waitForSelector("[data-testid=approval-plain-tsk_1]", { timeout: 8000 })
      .catch(() => report.push(`${tag} no plain question`));
    await shot("plain-question");
    await page
      .getByTestId("approval-yes-tsk_1")
      .click({ timeout: 3000 })
      .catch(() => undefined);
    await go("/m/R32CHAT_01?part=answered");
    await shot("plain-question-answered");
    await ctx.close();
  }
await browser.close();
real.close?.();
fs.writeFileSync(path.join(out, "report.txt"), report.join("\n") + "\n");
console.log(report.join("\n"));
console.log("done", out);
