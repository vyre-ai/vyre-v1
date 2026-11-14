// How a discussion ends, the decision, in the real app (chat gap G57): the "talking it over" line becomes "Agents decided: ...", on a second client that is never reloaded too. Shot light and dark, desktop and phone,
// into shots-evidence/chat-round. The other two endings are test/chat.round.outcomes-b.live.test.ts. Needs Node 24, a Chromium and VYRE_APP_DIST; without them it skips and says why (a failure under VYRE_REQUIRE_CHROME).
import test from "node:test";
import { runEndings } from "./support/round-outcomes.ts";

test(
  "a discussion ends on a decision, and the line in the chat says so, on every open client",
  { timeout: 115_000 },
  async (t) => {
    await runEndings(t, ["decided"], { secondClient: true });
  },
);
