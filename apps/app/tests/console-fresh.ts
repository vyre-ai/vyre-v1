// (shared by console.fresh-pages-a/b.live.test.ts, split so each stays under the 120 s file cap)
// A client's first look at the Console (client walk, 11 Nov 2026): a fresh Space, nothing connected, no AI account, no agent work yet, and every page of every place opened through the real navigation as the owner.
// A page with nothing to show says so in plain words; it never shows an error, never stays on "Loading", never shows a raw id as a name, and the Space refuses none of the reads it makes (no 4xx or 5xx for the owner).
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SECTIONS } from "../src/console/shell/sections.ts";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { openConsolePage } from "./console-nav.ts";
import { PAGES } from "../src/places/settings/model.ts";

const PASSWORD = "fixture password 123";
/** What a page says when it failed to show what a fresh Space has nothing of. */
const ERROR_TEXT = /Couldn[’']t load|Couldn[’']t draw|Check access and try again|Something went wrong|HTTP [45]\d\d|could not be loaded|is not implemented/i;
/** A raw id where a person's name belongs. */
const RAW_ID = /\b(spc|usr|agt|thr|msg|grp|rol|prj|itm|cmp)_[0-9a-f]{8,}\b/;

export async function runFreshPages(t: TestContext, titles: readonly string[], opts: { settings?: boolean } = {}): Promise<void> {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required"); return; }
  const pw = await import("playwright-core");
  const chromium = pw.chromium ?? (pw as unknown as { default: typeof pw }).default.chromium;
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  assert.ok(fs.existsSync(exe), `Chromium is required at ${exe}`);
  const space = await bootFreshSpace(undefined, true);
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const shots = path.join(process.env["VYRE_CONSOLE_PAGES_SHOTS"] ?? "/tmp/vyre-console-fresh-shots", titles[0]!); fs.mkdirSync(shots, { recursive: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const problems: string[] = [];
    let where = "claim";
    page.on("pageerror", (e) => problems.push(`${where}: page error ${e.message.slice(0, 160)}`));
    page.on("response", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/v1/") && r.status() >= 400 && r.status() !== 401) void r.text().then((b) => problems.push(`${where}: ${r.status()} ${u.pathname} ${b.slice(0, 220)}`)).catch(() => problems.push(`${where}: ${r.status()} ${u.pathname}`)); });
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Olivia Owner"); await page.getByTestId("claim-username").fill("olivia");
    await page.getByTestId("claim-password").fill(PASSWORD); await page.getByTestId("claim-confirm").fill(PASSWORD);
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click(); await dismissOnboarding(page);
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    if (opts.settings) {
      // Settings, You and the Space: each page of the list opened through the real navigation
      await page.goto(`${web.origin}/settings`, { waitUntil: "load" });
      await page.getByTestId("settings-place").waitFor({ timeout: 30_000 });
      for (const p of PAGES.filter((x) => x.hidden !== true && x.group === "you")) {
        where = `settings ${p.key}`;
        try {
          await page.getByTestId(`row-page-${p.key}`).click({ timeout: 15_000 });
          await page.waitForFunction(() => !document.body.innerText.split("\n").some((l) => l.trim() === "Loading…"), null, { timeout: 15_000 }).catch(() => problems.push(`${where}: still loading after 15 s`));
          await page.waitForTimeout(500);
          const text = await page.getByTestId("settings-place").innerText({ timeout: 5000 }).catch(() => "");
          const bad = ERROR_TEXT.exec(text); if (bad) problems.push(`${where}: says "${bad[0]}"`);
          const raw = RAW_ID.exec(text); if (raw) problems.push(`${where}: shows the raw id ${raw[0]}`);
          if (/Never seen/.test(text)) problems.push(`${where}: lists a server that was never seen`);
          const servers = (text.match(/Space server/g) ?? []).length; if (servers > 1) problems.push(`${where}: the Space server is listed ${servers} times`);
          await page.screenshot({ path: path.join(shots, `settings-${p.key}.png`), animations: "disabled" });
        } catch (e) { problems.push(`${where}: ${String(e).split("\n")[0]!.slice(0, 140)}`); }
      }
    } else {
    await page.goto(`${web.origin}/console`, { waitUntil: "load" });
    await page.getByTestId("console").waitFor({ timeout: 30_000 });
    for (const section of SECTIONS.filter((x) => titles.includes(x.title))) {
      for (const view of section.tabs.flatMap((tab) => tab.views)) {
        where = view.page;
        try {
          await openConsolePage(page, view.page, 20_000);
          await page.waitForFunction(() => !document.body.innerText.split("\n").some((l) => l.trim() === "Loading…"), null, { timeout: 20_000 }).catch(() => problems.push(`${where}: still loading after 20 s`));
          await page.waitForTimeout(400);
          const text = await page.getByTestId(`page-${view.page}`).innerText({ timeout: 5000 }).catch(() => "");
          const bad = ERROR_TEXT.exec(text); if (bad) problems.push(`${where}: says "${bad[0]}"`);
          const raw = RAW_ID.exec(text); if (raw) problems.push(`${where}: shows the raw id ${raw[0]}`);
          // an input that holds a raw id (a name field)
          const held = await page.evaluate(() => [...document.querySelectorAll("input")].map((i) => i.value).find((v) => /^(spc|usr|agt)_[0-9a-f]{8,}$/.test(v)) ?? "");
          if (held) problems.push(`${where}: a field holds the raw id ${held}`);
          await page.screenshot({ path: path.join(shots, `${view.page}.png`), animations: "disabled" });
        } catch (e) { problems.push(`${where}: ${String(e).split("\n")[0]!.slice(0, 140)}`); }
      }
    }
    }
    fs.writeFileSync(path.join(shots, `problems-${titles[0]}.txt`), problems.join("\n"));
    assert.deepEqual(problems, []);
  } finally { await browser.close(); web.close(); await space.stop(); fs.rmSync(space.dir, { recursive: true, force: true }); }
}
