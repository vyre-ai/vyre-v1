// @tsx
// New tab, ask, wait for the answer, new tab, ask again, many times at speed: the app must never show its crash page (a sweep saw "Couldn't open Vyre" with React error 185, maximum update depth, after
// this sequence twice). VYRE_NEWCHAT_ROUNDS sets the rounds (default 12); the case runs on loopback and through the relay (see chat.newchat-kit.test.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { walk } from "./chat.newchat-kit.test.ts";

const ROUNDS = Number(process.env["VYRE_NEWCHAT_ROUNDS"] ?? 12);

for (const [label, latency, startDelay] of [["loopback", 0, 0], ["relay", 150, 300]] as const) {
  test(`new tab, ask, answer, new tab, ask again, ${ROUNDS} rounds (${label}): no crash page, no console crash`, async (t) => {
    if (!process.env["VYRE_APP_DIST"]) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
    await walk(`loop-${label}`, latency, startDelay, async ({ page, web, v, guard, shots }) => {
      await page.goto(`${web.origin}/chat`, { waitUntil: "load" });
      await page.getByTestId("shell").waitFor({ timeout: 30_000 });
      let continued = 0;
      for (let i = 1; i <= ROUNDS; i++) {
        v.script.push({ text: `Answer number ${i}` });
        await page.getByTestId("tab-strip-plus").click();
        const box = page.getByTestId("cmdk-input");
        await box.waitFor({ timeout: 20_000 });
        await box.fill(`What is open for the Lisbon team, round ${i}?`);
        await box.press("Enter");
        await page.getByTestId("cmdk-answer").waitFor({ timeout: 20_000 }).catch(() => undefined);
        await page.getByTestId("cmdk-working").waitFor({ state: "detached", timeout: 30_000 }).catch(() => undefined);
        // Continue in a chat starts a real chat from the answer and moves the tab onto it: the tab switch the sweep's sequence ended on
        const more = page.getByTestId("cmdk-continue");
        if (await more.isVisible().catch(() => false)) { await more.click(); continued += 1; await page.getByTestId("composer-field").first().waitFor({ timeout: 20_000 }).catch(() => undefined); }
        await guard.check(`round ${i}`).catch(async (e: unknown) => { await page.screenshot({ path: `${shots}/loop-${label}-crash-${i}.png` }); throw e; });
      }
      console.log(`${label}: ${ROUNDS} rounds, Continue in a chat pressed ${continued} times`);
    });
  });
}
