// @tsx
// A chat that opens from a link with its own first message (Home's Ask, a task, a project, an agent), a server over the internet: 150 ms each way and 1.5 s before chat.start answers (see chat.newchat-kit.test.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { runAskCase, within } from "./chat.newchat-kit.test.ts";

test("an Ask that opens with his own message, a server over the internet: the message, the tab and the working mark are on screen within 100 ms", async (t) => {
  if (!process.env["VYRE_APP_DIST"]) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
  within("ask-relay", await runAskCase("ask-relay", 150, 1500));
});
