// @tsx
// Every place's list is the same pane: the same width, the same place beside the main pane, the same gap, with Hide and Expand that work (owner, 16 Nov 2026: "all panes need to be at the same place with
// same gap and padding etc and need to have collapse and expand thing and generally behave the same"). In the real app each place is opened and measured; the numbers must be identical.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";

test("shell: every place's sidebar has the same width, the same main pane edge and the same gap, and hides and comes back", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required");
    t.skip("VYRE_APP_DIST required for production browser evidence");
    return;
  }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  const shots = process.env["VYRE_TABS_SHOTS"] ?? "/tmp/vyre-shell-panes";
  fs.mkdirSync(shots, { recursive: true });
  const log = path.join(shots, "panes.txt");
  fs.writeFileSync(log, "");
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const page = await context.newPage();
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Pane Owner");
    await page.getByTestId("claim-username").fill("paneowner");
    await page.getByTestId("claim-password").fill("fixture password 123");
    await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click();
    await page.getByTestId("claim-create").click();
    await dismissOnboarding(page, { wait: 60_000 });
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const go = async (p: string): Promise<void> => {
      const target = page.locator(`[data-testid="rail-${p}"], [data-testid="rail-${p}-selected"]`).first();
      try {
        await target.click({ timeout: 2500 });
      } catch {
        await page.getByTestId("rail-isle-more").click({ timeout: 2500 });
        await page.waitForTimeout(300);
        await target.click({ timeout: 2500 });
      }
      await page.waitForTimeout(2200);
    };
    const measure = (): Promise<{ w: number; x: number; gap: number; hide: number; head: number } | null> =>
      page.evaluate(() => {
        const sb = document.querySelector('[data-testid="place-sidebar"]') as HTMLElement | null;
        const body = document.querySelector('[data-testid="place-body"]') as HTMLElement | null;
        if (!sb || !body) return null;
        const a = sb.getBoundingClientRect();
        const b = body.getBoundingClientRect();
        const title = sb.querySelector('[role="heading"], h1, h2, [aria-level]') as HTMLElement | null;
        return {
          w: Math.round(a.width),
          x: Math.round(b.left),
          gap: Math.round(b.left - a.right),
          hide: sb.querySelectorAll('[data-testid="sidebar-collapse"]').length,
          head: Math.round((title ?? sb).getBoundingClientRect().top - a.top),
        };
      });
    const rows: string[] = [];
    const seen: Record<string, { w: number; x: number; gap: number }> = {};
    for (const p of ["chats", "inbox", "records", "files", "automations", "vault", "settings"]) {
      await go(p);
      const m = await measure();
      assert.ok(m !== null, `${p} draws its list in the shell's sidebar column`);
      const line = `${p.padEnd(12)} sidebar width ${m.w}  main pane x ${m.x}  gap ${m.gap}  Hide controls ${m.hide}  head top ${m.head}`;
      rows.push(line);
      fs.appendFileSync(log, line + "\n");
      seen[p] = m;
      if (["chats", "inbox", "settings", "vault"].includes(p)) await page.screenshot({ path: path.join(shots, `shell-${p}.png`) });
      // Hide, then Expand
      await page.getByTestId("sidebar-collapse").first().click();
      await page.waitForTimeout(700);
      const hidden = await page.evaluate(() => {
        const body = document.querySelector('[data-testid="place-body"]') as HTMLElement | null;
        return body === null ? -1 : Math.round(body.getBoundingClientRect().left);
      });
      const expand = await page.getByTestId("sidebar-expand").count();
      fs.appendFileSync(log, `${"".padEnd(12)} hidden: main pane x ${hidden}, Expand control ${expand}\n`);
      if (["chats", "inbox", "settings", "vault"].includes(p)) await page.screenshot({ path: path.join(shots, `shell-${p}-hidden.png`) });
      assert.ok(hidden >= 0 && hidden < m.x - 100, `${p}: Hide puts the sidebar away: the main pane moves left (${m.x}, now ${hidden})`);
      assert.ok(expand > 0, `${p}: Expand is there`);
      await page.getByTestId("sidebar-expand").first().click();
      await page.waitForTimeout(700);
      const back = await measure();
      assert.ok(back !== null && back.w === m.w, `${p}: Expand brings it back at the same width (${m.w}, now ${back?.w})`);
    }
    const first = seen["chats"]!;
    for (const [p, m] of Object.entries(seen)) {
      assert.deepEqual({ w: m.w, x: m.x, gap: m.gap }, { w: first.w, x: first.x, gap: first.gap }, `${p}: the same width, main pane edge and gap as Chats\n${rows.join("\n")}`);
    }
  } finally {
    await page.screenshot({ path: path.join(shots, "end.png") }).catch(() => undefined);
    await browser.close();
    await web.close();
    await space.stop();
  }
});
