// @tsx
// The owner's path, at speed: "+" in the tab strip (a new tab), a question, Enter, the Ask's answer, "Continue in a chat", the tab moving onto the real chat, then "+" again, many rounds. A sweep saw the whole-app crash page (React error 185,
// maximum update depth) twice after this sequence. The Space has a chat about the Lisbon team first, so the Ask has a source and the model stand-in is asked to answer. VYRE_NEWCHAT_ROUNDS sets the rounds (default 10).
import test from "node:test";
import assert from "node:assert/strict";
import { cannedAsk, walk } from "./chat.newchat-kit.test.ts";

const ROUNDS = Number(process.env["VYRE_NEWCHAT_ROUNDS"] ?? 10);

for (const [label, latency, startDelay] of [["loopback", 0, 0], ["relay", 150, 300]] as const) {
  test(`new tab, ask, continue in a chat, new tab again, ${ROUNDS} rounds (${label}): no crash page, no console crash, every Ask answered and continued`, async (t) => {
    if (!process.env["VYRE_APP_DIST"]) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
    await walk(`loop-${label}`, latency, startDelay, async ({ page, web, v, guard, shots, api }) => {
      const assistant = (await api("agents.list", {})).agents[0] as { agentId: string };
      await cannedAsk(page, latency > 0 ? 2000 : 800);
      await page.goto(`${web.origin}/chat`, { waitUntil: "load" });
      await page.getByTestId("shell").waitFor({ timeout: 30_000 });
      let continued = 0;
      for (let i = 1; i <= ROUNDS; i++) {
        v.script.push({ text: `The Lisbon team review is on Thursday [1]. Round ${i}.` });
        v.script.push({ text: `Opened round ${i}.` });
        await page.getByTestId("tab-strip-plus").click();
        const box = page.getByTestId("cmdk-input");
        // a page that never shows the search box is a crash or a hang: say which, with a picture, before anything else
        await box.waitFor({ timeout: 20_000 }).catch(async (e: unknown) => { await page.screenshot({ path: `${shots}/loop-${label}-nobox-${i}.png` }); await guard.check(`round ${i}, after "+"`); throw e; });
        await box.fill("Lisbon team review Thursday?");
        await box.press("Enter");
        await page.getByTestId("cmdk-continue").waitFor({ timeout: 40_000 }).catch(async (e: unknown) => { await page.screenshot({ path: `${shots}/loop-${label}-noanswer-${i}.png` }); throw e; });
        await page.getByTestId("cmdk-continue").click(); continued += 1;
        await page.getByTestId("composer-field").first().waitFor({ timeout: 30_000 }).catch(async (e: unknown) => { await page.screenshot({ path: `${shots}/loop-${label}-nochat-${i}.png` }); await guard.check(`round ${i}, after Continue in a chat`); console.log(`round ${i}: no chat composer; the page says: ${(await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300)}`); throw e; });
        await guard.check(`round ${i}`).catch(async (e: unknown) => { await page.screenshot({ path: `${shots}/loop-${label}-crash-${i}.png` }); throw e; });
      }
      assert.equal(continued, ROUNDS, "every round was answered and continued in a chat");
      console.log(`${label}: ${ROUNDS} rounds, Continue in a chat pressed ${continued} times`);
    });
  });
}
