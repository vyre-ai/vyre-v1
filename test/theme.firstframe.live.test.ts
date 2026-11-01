// The first frame in the real web export: the head script reads the stored skin and mode (vyre.appearance.v1) and System follows the device, before the app's own code runs. This is what a quit and
// reopen of the desktop app shows first; the packaged window (hidden until the page has loaded, apps/desktop/src-tauri) can only be proven by the desktop job.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { edge } from "../apps/app/tests/real-app-harness.test.ts";

const KEY = "vyre.appearance.v1";
const store = (row: Record<string, string>): string => JSON.stringify({ personId: "p1", spaceId: "s1", spaces: { s1: row }, spaceSkin: {} });

test("the first frame carries the stored skin and mode, and System follows the device", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  assert.ok(fs.existsSync(exe), `Chromium is required at ${exe}`);
  const web = await edge(dist, "http://127.0.0.1:9");
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const first = async (o: { stored?: string; device: "light" | "dark" }): Promise<{ mode: string | null; skin: string | null; theme: string | null; bg: string }> => {
    const ctx = await browser.newContext({ colorScheme: o.device });
    try {
      const page = await ctx.newPage();
      if (o.stored) await page.addInitScript(([k, v]) => { try { localStorage.setItem(k as string, v as string); } catch { /* none */ } }, [KEY, o.stored]);
      await page.goto(web.origin + "/", { waitUntil: "domcontentloaded" });
      // read at once: before the app's own code has had to run
      return await page.evaluate(() => { const r = document.documentElement; return { mode: r.getAttribute("data-mode"), skin: r.getAttribute("data-skin"), theme: r.getAttribute("data-theme"), bg: r.style.backgroundColor }; });
    } finally { await ctx.close(); }
  };
  try {
    const dark = await first({ stored: store({ skin: "graphite", mode: "auto" }), device: "light" });
    assert.deepEqual([dark.skin, dark.mode, dark.theme], ["graphite", "dark", "dark"], "a stored dark skin is on the first frame even when the device is light");
    assert.notEqual(dark.bg, "", "the root background is set");
    const sysDark = await first({ device: "dark" });
    assert.deepEqual([sysDark.skin, sysDark.mode], ["system", "dark"], "no choice yet: System, dark on a dark device");
    const sysLight = await first({ device: "light" });
    assert.deepEqual([sysLight.skin, sysLight.mode], ["system", "light"], "System, light on a light device");
    assert.notEqual(sysDark.bg, sysLight.bg, "the two System frames differ");
    const forced = await first({ stored: store({ skin: "system", mode: "light" }), device: "dark" });
    assert.deepEqual([forced.skin, forced.mode], ["system", "light"], "a chosen light mode beats a dark device");
  } finally { await browser.close(); web.close(); }
});
