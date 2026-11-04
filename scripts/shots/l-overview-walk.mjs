// Walks the project Overview page in the real browser editor: the page, an agent's edit and Undo, a property edit, the "/" menu inserting a live block, a block's settings, History, Templates, and read
// mode; paper and graphite, wide and phone. Run on the build box: /root/export-slot.sh node scripts/shots/l-overview-walk.mjs [out-dir] [--skip-export]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const out = process.argv.slice(2).find((a) => !a.startsWith("--")) || "/root/wt/l-tools-out/overview";
fs.mkdirSync(out, { recursive: true });
if (!process.argv.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync(`${path.join(REPO, "node_modules/.bin/expo")} export --platform web --output-dir dist`, { cwd: appDir, stdio: "inherit", env: exportEnv() });
}
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
let failed = 0;
const check = (n, ok, x = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${n}${ok ? "" : " " + x}`); if (!ok) failed++; };
const T = (id) => `[data-testid="${id}"]`;
for (const skin of ["paper", "graphite"]) for (const [size, vp] of [["wide", { width: 1100, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
  const tag = `${skin}-${size}`;
  const ctx = await browser.newContext({ viewport: vp, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", String(e).slice(0, 200)));
  // the crash guard (apps/app/tests/crash-guard.ts), inline: an error page on screen or a React/script error fails the walk before any shot is taken
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(String(e).slice(0, 300)));
  page.on("console", (m) => { if (m.type() === "error" && /Minified React error|React error|Invalid hook call|Rendered (more|fewer) hooks|Cannot read properties|is not a function|Uncaught|ReferenceError|TypeError/i.test(m.text())) crashes.push(m.text().slice(0, 300)); });
  const shoot = page.screenshot.bind(page);
  page.screenshot = async (o) => {
    const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    for (const b of ["Couldn't draw this page", "Couldn't open Vyre", "Something went wrong here"]) if (text.includes(b)) throw new Error(`crash guard: an error page is on screen ("${b}") before ${o?.path}`);
    if (crashes.length) throw new Error(`crash guard: ${crashes.join(" | ")}`);
    return shoot(o);
  };
  const go = async (q = "") => { await page.goto(routeUrl(real.origin, `/m/OVERVIEW_01${q}`, skin), { waitUntil: "load", timeout: 60000 }); await page.waitForSelector(T("project-overview"), { timeout: 20000 }); await page.waitForSelector(T("live-tasks"), { timeout: 15000 }); await page.waitForTimeout(500); };
  await go();
  check(`${tag}: the page shows properties, two live blocks and the editor`, (await page.locator(T("prop-contract")).count()) === 1 && (await page.locator(T("live-tasks")).count()) === 1 && (await page.locator(T("live-records")).count()) === 1 && (await page.locator(".ProseMirror").count()) === 1);
  check(`${tag}: a live block counts what the reader cannot open`, /2 more you can't open/.test((await page.textContent(T("live-hidden"))) ?? ""));
  const op = size === "wide" ? await page.evaluate(() => getComputedStyle(document.querySelector("[data-lb-tools]")).opacity) : (await page.locator(`${T("live-tasks")} ${T("live-edit")}`).isVisible() ? "on" : "off");
  check(`${tag}: a live block's strip is hidden at rest on a wide page and always on at phone width`, size === "wide" ? op === "0" : op === "on", `opacity ${op}`);
  check(`${tag}: a live block has no card border`, (await page.evaluate(() => { const b = document.querySelector("[data-lb]"); const c = getComputedStyle(b); return c.borderTopWidth === "0px" && (c.backgroundColor === "rgba(0, 0, 0, 0)" || c.backgroundColor === "transparent"); })));
  await page.screenshot({ path: path.join(out, `overview-page-${tag}.png`) });
  if (size === "wide") { await page.locator(`${T("live-tasks")}`).hover(); await page.waitForTimeout(300); await page.screenshot({ path: path.join(out, `overview-hover-${tag}.png`) }); }
  // a property edit saves as a version
  await page.fill(`${T("prop-contract")}`, "$52,000");
  await page.locator(T("prop-contract")).blur();
  await page.waitForTimeout(500);
  check(`${tag}: editing a property adds a version`, /2 versions/.test((await page.textContent(T("overview-line"))) ?? ""));
  // typing in the page saves by itself
  await page.click(".ProseMirror p");
  await page.keyboard.press("End");
  await page.keyboard.type(" Kickoff is Friday.");
  await page.waitForTimeout(1600);
  check(`${tag}: typing saves by itself`, /Saved/.test((await page.textContent(T("overview-status"))) ?? "") && /3 versions/.test((await page.textContent(T("overview-line"))) ?? ""));
  // the slash menu inserts a live block
  await page.click(".ProseMirror h1");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await page.waitForTimeout(300);
  check(`${tag}: the slash menu lists the kinds of live block`, (await page.locator("[data-testid=md-suggest-milestones]").count()) === 1);
  check(`${tag}: the slash menu has two groups, Basic blocks then Live blocks`, (await page.locator("[data-testid='md-suggest-head-Basic blocks']").count()) === 1 && (await page.locator("[data-testid='md-suggest-head-Live blocks']").count()) === 1 && (await page.locator("[data-testid=md-suggest-basic-check]").count()) === 1);
  await page.screenshot({ path: path.join(out, `overview-slash-${tag}.png`) });
  await page.keyboard.type("miles");
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  check(`${tag}: picking Milestones inserts a third live block`, (await page.locator(T("live-milestones")).count()) === 1);
  // a block's settings
  await page.locator(`${T("live-tasks")} ${T("live-edit")}`).first().click();
  await page.waitForSelector(T("live-settings"), { timeout: 5000 });
  await page.waitForTimeout(500);
  check(`${tag}: the Edit sheet says what the block shows (Live · ...), the line the phone has no hover for`, /^Live \u00B7 Tasks where status is open/.test((await page.textContent(T("live-settings-live"))) ?? ""));
  await page.screenshot({ path: path.join(out, `overview-settings-${tag}.png`) });
  check(`${tag}: the settings use selects, not pills`, (await page.locator(`${T("live-settings")} select`).count()) >= 2 && (await page.locator(`${T("live-settings")} ${T("live-spec-status")} option`).count()) === 5);
  await page.selectOption(T("live-spec-status"), "late");
  await page.selectOption(T("live-view"), "table");
  await page.click(T("live-settings-save"));
  await page.waitForTimeout(600);
  check(`${tag}: settings change the block (a table of late tasks)`, (await page.locator(T("live-table")).count()) >= 1);
  // the strip's actions are reachable on every width: the block's menu (the phone's way, since it has no hover) removes a block
  const liveBefore = await page.locator(T("live-block")).count();
  await page.locator(`${T("live-milestones")} ${T("live-menu")}`).click();
  await page.waitForSelector('[data-testid="menu-item-Remove from the page"]', { timeout: 5000 });
  await page.screenshot({ path: path.join(out, `overview-blockmenu-${tag}.png`) });
  check(`${tag}: the block menu offers Edit settings and Remove`, (await page.locator('[data-testid="menu-item-Edit settings"]').count()) === 1);
  await page.click('[data-testid="menu-item-Remove from the page"]');
  await page.waitForTimeout(500);
  check(`${tag}: Remove from the block menu takes the block off the page`, (await page.locator(T("live-block")).count()) === liveBefore - 1 && (await page.locator(T("live-milestones")).count()) === 0);
  // history
  await page.click(T("overview-history-open"));
  await page.waitForSelector(T("overview-history"), { timeout: 5000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, `overview-history-${tag}.png`) });
  check(`${tag}: history lists versions with Undo on the latest and Restore on the older ones`, (await page.locator("[data-testid^=rev-undo-]").count()) === 1 && (await page.locator("[data-testid^=rev-restore-]").count()) >= 2);
  await page.click(T("overview-history-done"));
  // templates
  await page.click(T("overview-template-open"));
  await page.waitForSelector(T("row-tpl-tpl_hiring"), { timeout: 5000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, `overview-templates-${tag}.png`) });
  await page.click(T("overview-templates-cancel"));
  // an agent's edit and Undo
  await go("?agent=1");
  check(`${tag}: an agent's edit leaves a bar with Undo`, (await page.locator(T("overview-notice-undo")).count()) === 1);
  await page.screenshot({ path: path.join(out, `overview-agent-${tag}.png`) });
  const line = (await page.textContent(T("live-metric-line"))) ?? "";
  const big = (await page.textContent(T("live-number"))) ?? "";
  check(`${tag}: the agent's metric reads as a sentence with its currency`, /\$6,250/.test(big) && /unpaid across 3 invoices/.test(line) && /Unpaid/.test((await page.textContent(T("overview-notice"))) ?? ""), `${big} | ${line}`);
  await page.click(T("overview-history-open"));
  await page.waitForSelector(T("row-rev-2"), { timeout: 5000 });
  check(`${tag}: history says an agent made the edit`, /Edited by Docs \(Agent\)/.test((await page.textContent(T("row-rev-2"))) ?? ""));
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, `overview-agenthist-${tag}.png`) });
  await page.click(T("overview-history-done"));
  await page.click(T("overview-notice-undo"));
  await page.waitForTimeout(800);
  check(`${tag}: Undo removes the agent's block and the bar`, (await page.locator(T("overview-notice")).count()) === 0 && (await page.locator(T("live-metric")).count()) === 0);
  // read mode
  await go("?read=1");
  check(`${tag}: read mode hides a property with no value`, (await page.locator(T("prop-repo")).count()) === 0);
  check(`${tag}: read mode has no controls and keeps the live blocks`, (await page.locator(T("prop-add")).count()) === 0 && (await page.locator(T("live-edit")).count()) === 0 && (await page.locator(T("live-tasks")).count()) === 1 && (await page.locator(".ProseMirror[contenteditable=true]").count()) === 0);
  await page.screenshot({ path: path.join(out, `overview-read-${tag}.png`) });
  await ctx.close();
}
await browser.close(); real.close();
process.exit(failed ? 1 : 0);
