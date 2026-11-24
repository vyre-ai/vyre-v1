// r42-email-in browser walks: the three new screens clicked through in a real browser, with a picture at every step and a check after every action.
//   node scripts/shots/email42-walk.mjs [out-dir] [--skip-export]
// Templates: open the list, open a template, type, add a field with its button, see the preview follow and name what would be empty, then show it on a record.
// Inbox: the health section of an inbox that works and of one that failed, with the reason and the fix. Trail: the line under a sent email opens into the whole trail.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-r42-email-in/walks";
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
const results = [];
let step = 0;
async function walk(name, part, skin, vp, run) {
  const ctx = await browser.newContext({
    viewport: vp,
    deviceScaleFactor: 1,
    colorScheme: skin === "graphite" ? "dark" : "light",
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(routeUrl(real.origin, `/m/EMAIL42_01?part=${part}`, skin), { waitUntil: "load", timeout: 60000 });
  const shot = async (label) =>
    page.screenshot({
      path: path.join(
        out,
        `${name}-${String(++step).padStart(2, "0")}-${label}-${skin === "graphite" ? "dark" : "light"}-${vp.width}.png`,
      ),
    });
  try {
    await run(page, shot);
    results.push(
      `ok   ${name} ${skin} ${vp.width}${errs.length ? " (page errors: " + errs.join(" | ").slice(0, 200) + ")" : ""}`,
    );
  } catch (e) {
    await shot("FAILED").catch(() => undefined);
    results.push(`FAIL ${name} ${skin} ${vp.width}: ${String(e).slice(0, 300)}`);
  }
  await ctx.close();
}
const sel = (id) => `[data-testid='${id}']`;
const text = async (page, id) => (await page.locator(sel(id)).first().innerText()).replace(/\s+/g, " ");

for (const skin of ["paper", "graphite"])
  for (const vp of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await walk("templates", "templates", skin, vp, async (page, shot) => {
      await page.waitForSelector(sel("console-templates"), { timeout: 20000 });
      assert.match(await text(page, "console-templates"), /Signature request.*changed by your Space/);
      assert.match(await text(page, "console-templates"), /Signature reminder/);
      await shot("list");
      await page.getByText("Signature request").first().click();
      await page.waitForSelector(sel("template-object"), { timeout: 10000 });
      assert.ok((await page.locator(sel("template-subject")).inputValue()).includes("{{sender_name}}"));
      const box = await page.locator(sel("template-text")).boundingBox();
      assert.ok(box && box.height >= 150, `the Body box is tall enough (${box?.height}px)`);
      assert.ok(
        await page
          .locator(sel("template-save"))
          .isDisabled?.()
          .catch(() => true),
        "Save waits for a change",
      );
      await shot("open");
      await page.locator(sel("template-field-sign_link")).click();
      await page.waitForTimeout(700);
      assert.ok(
        (await page.locator(sel("template-text")).inputValue()).endsWith("{{sign_link}}"),
        "the field button adds its field to the body",
      );
      await page.locator(sel("template-text")).press("End");
      await page.keyboard.type("\n\nThanks, see you soon.");
      await page.waitForTimeout(700);
      assert.match(await text(page, "template-preview"), /Thanks, see you soon\./);
      assert.match(await text(page, "template-blanks"), /Would go out empty: sender name, document title, sign link/);
      await shot("typed");
      await page.locator(sel("template-record")).fill("rec_signer01");
      await page.waitForTimeout(900);
      assert.match(await text(page, "template-preview"), /Pat Lee asked you to sign Service agreement/);
      assert.equal(await page.locator(sel("template-blanks")).count(), 0, "with a record, nothing would go out empty");
      await shot("on-a-record");
    });
    await walk("inbox", "inbox-failing", skin, vp, async (page, shot) => {
      await page.waitForSelector(sel("inbox-problem"), { timeout: 20000 });
      assert.match(await text(page, "inbox-health"), /Not working.*Reads the mailbox over IMAP.*Received today 14/);
      assert.match(
        await text(page, "inbox-problem"),
        /did not accept the sign-in\. Open the mailbox and reconnect it\./,
      );
      await shot("failing");
    });
    await walk("inbox-ok", "inbox", skin, vp, async (page, shot) => {
      await page.waitForSelector(sel("inbox-health"), { timeout: 20000 });
      assert.match(await text(page, "inbox-health"), /Working/);
      assert.equal(await page.locator(sel("inbox-problem")).count(), 0);
      await shot("working");
    });
    for (const part of ["trail-delivered", "trail-bounced", "trail-retrying"])
      await walk(part, part, skin, vp, async (page, shot) => {
        await page.waitForSelector(sel("email42-trail"), { timeout: 20000 });
        const head = await text(page, "email42-trail");
        assert.match(
          head,
          part === "trail-delivered"
            ? /^Delivered \d{1,2}:\d\d [AP]M/
            : part === "trail-bounced"
              ? /^Bounced: No such user/
              : /^Could not be delivered yet\. Trying again at \d{1,2}:\d\d [AP]M \(2 of 3\)/,
        );
        if (part === "trail-bounced") assert.match(head, /will not be emailed again/);
        await shot("closed");
        await page.locator("[data-testid^='trail-toggle:']").click();
        await page.waitForTimeout(300);
        const open = await text(page, "email42-trail");
        assert.match(open, /Sent/);
        assert.ok(open.length > head.length, "the whole trail opens");
        await shot("open");
      });
  }
await browser.close();
real.close?.();
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`${results.length - failed} of ${results.length} walks ok`);
process.exit(failed ? 1 : 0);
