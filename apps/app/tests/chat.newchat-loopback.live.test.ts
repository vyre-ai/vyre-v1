// @tsx
// The first message of a new chat, server on loopback (see chat.newchat-kit.test.ts for the walk and the budget).
import test from "node:test";
import assert from "node:assert/strict";
import { runCase, within } from "./chat.newchat-kit.test.ts";

test("new chat first message, server on loopback: his message, the tab and the working mark are on screen within 100 ms", async (t) => {
  if (!process.env["VYRE_APP_DIST"]) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
  within("loopback", await runCase("loopback", 0, 0));
});

