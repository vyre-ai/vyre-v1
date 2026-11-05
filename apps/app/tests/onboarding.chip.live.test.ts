// The Finish setup entry in a real browser (lane l-addsheet-22): a brand-new Space has none in the title bar (no "0 of 9"); after a step is done it says "1 of 9"; when every step is done or put off it is gone.
// Shots of the bar (paper and graphite, 1440 wide) go to VYRE_SETUP_CHIP_SHOTS. A crash or a failed check makes the run red.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { guardCrashes } from "./crash-guard.ts";

const PASSWORD = "fixture password 123";
const TEAM = ["org", "space_ai", "workspace", "sign_in", "people", "invites", "agents", "shared", "win"];

test("Finish setup entry: none on a brand-new Space, a true count once a step is done, gone when setup is done", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const shots = process.env["VYRE_SETUP_CHIP_SHOTS"] ?? "/tmp/vyre-setup-chip-shots"; fs.mkdirSync(shots, { recursive: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const guard = guardCrashes(page);
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Olivia Owner"); await page.getByTestId("claim-username").fill("olivia");
    await page.getByTestId("claim-password").fill(PASSWORD); await page.getByTestId("claim-confirm").fill(PASSWORD);
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click();
    await dismissOnboarding(page);
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string);
    const call = async (cap: string, data: unknown): Promise<any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await ctx.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data });
      const body = await r.json();
      assert.equal(r.status(), 200, `${cap}: ${JSON.stringify(body).slice(0, 300)}`);
      return body.data;
    };
    const shoot = async (name: string): Promise<void> => {
      await guard.check(`before ${name}`);
      for (const [skin, q] of [["paper", null], ["graphite", "graphite"]] as const) {
        const u = new URL(page.url()); if (q) u.searchParams.set("skin", q); else u.searchParams.delete("skin");
        if (q) { await page.goto(u.toString(), { waitUntil: "load" }); await page.getByTestId("shell").waitFor({ timeout: 30_000 }); await dismissOnboarding(page, { wait: 1500 }); await page.waitForTimeout(1500); }
        await guard.check(`${name} ${skin}`);
        await page.screenshot({ path: path.join(shots, `${name}-${skin}-1440.png`), clip: { x: 0, y: 0, width: 1440, height: 110 } });
      }
      await page.goto(new URL(page.url()).origin + "/chat", { waitUntil: "load" });
      await page.getByTestId("shell").waitFor({ timeout: 30_000 });
      await dismissOnboarding(page, { wait: 1500 });
      await page.waitForTimeout(1200);
    };
    await page.goto(`${web.origin}/chat`, { waitUntil: "load" });
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await guard.check("brand-new Space");
    assert.equal(await page.getByTestId("resume-chip").count(), 0, "no entry in the bar on a brand-new Space");
    await shoot("setup-1-brand-new");

    await call("spaces.onboarding.mark", { flow: "team", step: "org", state: "done" });
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    await dismissOnboarding(page, { wait: 1500 });
    await page.getByTestId("resume-chip").waitFor({ timeout: 15_000 });
    assert.match(await page.getByTestId("resume-open").getAttribute("aria-label") ?? "", /Finish setup, 1 of 9/, "one step done of the nine");
    await shoot("setup-2-one-done");

    for (const k of TEAM.slice(1)) await call("spaces.onboarding.mark", { flow: "team", step: k, state: k === "win" ? "later" : "done" });
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    await dismissOnboarding(page, { wait: 1500 });
    await page.waitForTimeout(1500);
    assert.equal(await page.getByTestId("resume-chip").count(), 0, "gone when every step is done or put off");
    await shoot("setup-3-all-done");
    await guard.check("at the end");
    assert.deepEqual(guard.crashes(), [], "no crash");
  } finally { await browser.close(); web.close(); await space.stop(); }
});
