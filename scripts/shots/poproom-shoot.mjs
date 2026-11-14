// Walk for the composer's popovers with little room (F32): the Add menu opens on the side with more room, never off-screen; when neither side fits it scrolls inside and fades at the edge with more behind it.
// For the composer at the top and at the foot of a pane, with and without a clipping pane, at window heights 160, 260 and 420, in paper and graphite, it checks that a fresh menu starts at its first row (scrollTop 0), has focus
// on that row, ArrowDown moves focus to the next row and keeps it in the window, every row is inside the window and under the pointer, and Escape closes it with focus back on the + button. Exits 1 on any failure.
// Run on the build box from the worktree (the shots app must be exported: `node scripts/shots/poproom-shoot.mjs out-dir --export`):
//   node scripts/shots/poproom-shoot.mjs [out-dir] [--export]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || path.join(REPO, "shots-out/poproom");
const appDir = path.join(REPO, "scripts/shots/app");
if (args.includes("--export")) {
  const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
  const { exportCmd } = await import(path.join(REPO, "scripts/shots/expo-cmd.mjs"));
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync(exportCmd(REPO), { cwd: appDir, stdio: "inherit", env: exportEnv() });
}
fs.mkdirSync(out, { recursive: true });
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const bad = [];
for (const skin of ["paper", "graphite"])
  for (const h of [160, 260, 420])
    for (const pos of ["top", "bottom"])
      for (const pane of ["1", "0"]) {
        const tag = `${skin} h=${h} pos=${pos} pane=${pane}`;
        const ctx = await browser.newContext({ viewport: { width: 1000, height: h }, reducedMotion: "no-preference" });
        const page = await ctx.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message.slice(0, 120)));
        await page.goto(routeUrl(real.origin, `/m/POPROOM_01?pos=${pos}&pane=${pane}`, skin), { waitUntil: "load" });
        await page.waitForTimeout(1000);
        await page.locator("[data-testid=composer-attach]").first().click();
        await page.waitForTimeout(900);
        const fresh = await page.evaluate(() => {
          const p = document.querySelector("[data-testid=composer-plus]");
          if (!p) return null;
          const first = p.querySelector("button,[role=button]");
          return {
            scrollTop: p.scrollTop,
            focusOnFirst: !!first && document.activeElement === first,
            firstTestId: first?.getAttribute("data-testid"),
          };
        });
        if (!fresh) bad.push(`${tag}: the menu did not open ${errors.join(" ")}`);
        else {
          if (fresh.scrollTop !== 0) bad.push(`${tag}: a fresh menu starts scrolled (${fresh.scrollTop})`);
          if (!fresh.focusOnFirst) bad.push(`${tag}: focus is not on the first row`);
          if (h === 160 && (pos === "top" || pane === "1"))
            await page.screenshot({ path: path.join(out, `fresh-${skin}-h${h}-${pos}-pane${pane}.png`) });
          await page.keyboard.press("ArrowDown");
          const moved = await page.evaluate(() => {
            const a = document.activeElement;
            const r = a?.getBoundingClientRect();
            return { id: a?.getAttribute("data-testid"), inWindow: !!r && r.top >= 0 && r.bottom <= innerHeight };
          });
          if (!moved.id || moved.id === fresh.firstTestId)
            bad.push(`${tag}: ArrowDown did not move focus (${moved.id})`);
          else if (!moved.inWindow) bad.push(`${tag}: the focused row is not in the window after ArrowDown`);
          const rows = await page.evaluate(() => {
            const p = document.querySelector("[data-testid=composer-plus]");
            return [...p.querySelectorAll("button,[role=button]")].map((e) => {
              e.scrollIntoView({ block: "nearest" });
              const r = e.getBoundingClientRect();
              const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
              return {
                id: e.getAttribute("data-testid"),
                inWindow: r.top >= 0 && r.bottom <= innerHeight,
                press: !!hit && (e.contains(hit) || hit.contains(e)),
              };
            });
          });
          for (const r of rows)
            if (!r.inWindow || !r.press)
              bad.push(
                `${tag}: ${r.id} ${r.inWindow ? "" : "outside the window "}${r.press ? "" : "not under the pointer"}`,
              );
          if (!rows.length) bad.push(`${tag}: no rows`);
          await page.keyboard.press("Escape");
          const closed = await page.evaluate(() => ({
            open: !!document.querySelector("[data-testid=composer-plus]"),
            onButton: document.activeElement?.getAttribute("data-testid"),
          }));
          if (closed.open) bad.push(`${tag}: Escape did not close the menu`);
          else if (closed.onButton !== "composer-attach")
            bad.push(`${tag}: focus did not return to the + button (${closed.onButton})`);
        }
        await ctx.close();
      }
await browser.close();
real.close();
console.log(bad.length === 0 ? "poproom walk: ALL OK" : `poproom walk: ${bad.length} failure(s)\n${bad.join("\n")}`);
process.exit(bad.length === 0 ? 0 : 1);
