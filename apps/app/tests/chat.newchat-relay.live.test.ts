// @tsx
// The first message of a new chat, a server over the internet: 150 ms each way and 1.5 s before chat.start answers (see chat.newchat-kit.test.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { runCase, within } from "./chat.newchat-kit.test.ts";

test("new chat first message, a server over the internet (150 ms each way, 1.5 s before chat.start answers): the same budget", async (t) => {
  if (!process.env["VYRE_APP_DIST"]) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
  within("relay", await runCase("relay", 150, 1500));
});

