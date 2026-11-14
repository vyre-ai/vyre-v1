// @tsx
// The other bound of the slow link: calls are not queued at the browser's six connections per address (as on a multiplexed link) and each still pays 150 ms each way, with 1.5 s before chat.start answers (see chat.newchat-kit.test.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { runCase, tokenWithin, within } from "./chat.newchat-kit.test.ts";

test("new chat first message, a multiplexed slow link: his message, the tab and the working mark within 100 ms, the first words within 300 ms of reaching the page", async (t) => {
  if (!process.env["VYRE_APP_DIST"]) {
    if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required");
    t.skip("VYRE_APP_DIST required for production browser evidence");
    return;
  }
  process.env["VYRE_NEWCHAT_MUX"] = "1";
  try {
    const got = await runCase("mux", 150, 1500);
    within("mux", got);
    tokenWithin("mux", got);
  } finally {
    delete process.env["VYRE_NEWCHAT_MUX"];
  }
});
