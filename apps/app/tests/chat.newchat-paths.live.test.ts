// @tsx
// The three ways to start a chat, as the owner does: "+" in the tab strip, "+ New chat" in the Chats sidebar, and the first screen's composer, with an agent chat open first. What the page shows from Enter on, in order, with pictures
// (see chat.newchat-kit.test.ts). Without asserting yet: this records what each path does.
import test from "node:test";
import assert from "node:assert/strict";
import { runPathProbe } from "./chat.newchat-kit.test.ts";

for (const path of ["tabplus", "sidebar", "first"] as const) {
  for (const [label, latency, delay] of [["probe-loopback", 0, 0], ["probe-relay", 150, 1500]] as const) {
    test(`path ${path} (${label}): what the page shows from Enter on`, async (t) => {
      if (!process.env["VYRE_APP_DIST"]) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
      const rows = await runPathProbe(label, latency, delay, path);
      console.log("PATH " + JSON.stringify(rows.map((r) => ({ path: r.path, step: r.step, first_ms: r.first_acknowledged_ms, transitions: r.transitions }))));
      assert.ok(rows.length > 0);
    });
  }
}
