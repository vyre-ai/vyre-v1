// Polish audit shots in the real app: Cmd-K with one row per thing and no raw brackets, and the Console Hooks list with a hook that never ran. Light and graphite, crash guard before each shot.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { openConsolePage } from "./console-nav.ts";
import { guardCrashes } from "./crash-guard.ts";

test("polish shots: Cmd-K and Hooks", async (t) => {
  const dist = process.env["VYRE_APP_DIST"]; if (!dist) { t.skip("VYRE_APP_DIST required"); return; }
  const { chromium } = await import("playwright-core");
  const space = await bootFreshSpace(), web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: process.env["CHROME_BIN"] || chromium.executablePath(), args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage(); const guard = guardCrashes(page);
  const out = process.env["POLISH_SHOTS"] ?? "/tmp/polish-shots"; fs.mkdirSync(out, { recursive: true });
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Olivia Owner"); await page.getByTestId("claim-username").fill("olivia");
    await page.getByTestId("claim-password").fill("fixture password 123"); await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click(); await dismissOnboarding(page);
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string);
    const api = async (cap: string, data: unknown): Promise<any> => { const r = await context.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data }); const j = await r.json(); assert.equal(r.status(), 200, `${cap}: ${JSON.stringify(j)}`); return j.data; }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const ch = await api("channels.create", { name: "launch-page-live-by-friday", visibility: "public", idempotencyKey: "ch1" });
    await api("chat.post", { threadId: ch.channel.mainThreadId, body: "Review the launch post before it goes out", idempotencyKey: "m1" });
    await api("channels.create", { name: "launch", visibility: "public", idempotencyKey: "ch2" });
    await api("hooks.set", { scope: "space", event: "prompt.submit", kind: "command", command: "echo ok", summary: "note the house word before each message", idempotencyKey: "hk1" });
    for (const skin of ["paper", "graphite"] as const) {
      const tag = skin === "paper" ? "light" : "graphite";
      await page.goto(`${web.origin}/chats?skin=${skin}`, { waitUntil: "load" }); await page.getByTestId("shell").waitFor({ timeout: 30_000 });
      await page.keyboard.press("Control+K"); await page.getByTestId("cmdk-input").waitFor({ timeout: 10_000 });
      await page.getByTestId("cmdk-input").type("laun", { delay: 30 }); await page.waitForTimeout(1500);
      const text = await page.locator("body").innerText();
      assert.ok(!/\[launch\]/i.test(text), "no raw brackets in the palette");
      await guard.check(`cmdk ${skin}`); await page.screenshot({ path: path.join(out, `3-cmdk-${tag}.png`), animations: "disabled" }); await page.keyboard.press("Escape");
      await page.goto(`${web.origin}/console?skin=${skin}`, { waitUntil: "load" }); await page.getByTestId("console").waitFor({ timeout: 30_000 }); await openConsolePage(page, "hooks"); await page.getByTestId("hooks-list").waitFor({ timeout: 20_000 });
      assert.ok((await page.getByTestId("hooks-list").innerText()).includes("Never ran"), "a hook with no run says Never ran");
      await guard.check(`hooks ${skin}`); await page.screenshot({ path: path.join(out, `4-hooks-${tag}.png`), animations: "disabled" });
    }
  } finally { await browser.close(); web.close(); await space.stop(); }
});
