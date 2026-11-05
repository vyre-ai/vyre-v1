// The line a hook leaves in a chat names the person who added it (not Someone), in the real app, light and graphite, with the crash guard before each shot.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { guardCrashes } from "./crash-guard.ts";

test("a hook line names who added the hook", async (t) => {
  const dist = process.env["VYRE_APP_DIST"]; if (!dist) { t.skip("VYRE_APP_DIST required"); return; }
  const { chromium } = await import("playwright-core");
  const space = await bootFreshSpace(), web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: process.env["CHROME_BIN"] || chromium.executablePath(), args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage(); const guard = guardCrashes(page);
  const out = process.env["CREW_SHOTS"] ?? "/tmp/crew-shots"; fs.mkdirSync(out, { recursive: true });
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Maya Chen"); await page.getByTestId("claim-username").fill("maya");
    await page.getByTestId("claim-password").fill("fixture password 123"); await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click(); await dismissOnboarding(page);
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string);
    const api = async (cap: string, data: unknown): Promise<any> => { const r = await context.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data }); const j = await r.json(); assert.equal(r.status(), 200, `${cap}: ${JSON.stringify(j)}`); return j.data; }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const ch = await api("channels.create", { name: "intake", visibility: "public", idempotencyKey: "ch1" });
    await api("hooks.set", { scope: "chat", event: "outward.before", kind: "check", instruction: "address in Contacts", threadId: ch.channel.mainThreadId, summary: "before any email, check the address is in Contacts" });
    for (const skin of ["paper", "graphite"] as const) {
      await page.goto(`${web.origin}/chats?skin=${skin}`, { waitUntil: "load" }); await page.getByTestId("shell").waitFor({ timeout: 30_000 });
      await page.getByText("intake", { exact: true }).first().click();
      await page.getByText(/added a hook in this chat/).waitFor({ timeout: 20_000 });
      const text = await page.locator("body").innerText();
      assert.ok(/Maya Chen added a hook in this chat/.test(text), "the line names the person"); assert.ok(!/Someone added a hook/.test(text));
      await guard.check(`hook line ${skin}`); await page.screenshot({ path: path.join(out, `1-hookline-${skin === "paper" ? "light" : "graphite"}.png`), animations: "disabled" });
    }
  } finally { await browser.close(); web.close(); await space.stop(); }
});
