// @tsx
// A chat that opens from a link with its own first message (Home's Ask, a task, a project, an agent), a server over the internet: 150 ms each way and 1.5 s before chat.start answers (see chat.newchat-kit.test.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { runAskCase, within } from "./chat.newchat-kit.test.ts";

test("an Ask that opens with his own message, a server over the internet: the message, the tab and the working mark are on screen within 250 ms", async (t) => {
  if (!process.env["VYRE_APP_DIST"]) {
    if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required");
    t.skip("VYRE_APP_DIST required for production browser evidence");
    return;
  }
  // A link changes the route of the whole place before anything draws, so on this shared computer under load it takes longer than the key press of the first screen (which is local state): the measurement on a quiet computer was
  // 39 ms p50 and 53 ms p95, on a loaded one (load 19) 133 and 156. The budget here is 250 ms for that reason, and the point of the test is that none of it waits for the server (chat.start takes 1.5 s plus the round trips).
  within("ask-relay", await runAskCase("ask-relay", 150, 1500), 250);
});
