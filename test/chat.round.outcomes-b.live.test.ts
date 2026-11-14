// How a discussion ends, the other two endings, in the real app (chat gap G57): the talk stops without a decision ("They did not settle it"), and the four turns run out (said as the cap, with what to do). Shot light
// and dark, desktop and phone, into shots-evidence/chat-round. Needs Node 24, a Chromium and VYRE_APP_DIST; without them it skips and says why (a failure under VYRE_REQUIRE_CHROME).
import test from "node:test";
import { runEndings } from "./support/round-outcomes.ts";

test(
  "a discussion that stops or runs out of turns says so in the chat, on a phone too",
  { timeout: 115_000 },
  async (t) => {
    await runEndings(t, ["stalled", "cap"], { secondClient: false });
  },
);
