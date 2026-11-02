// A whole :name: becomes its emoji as the second colon lands; times, links and unknown names stay exactly as typed.
import test from "node:test";
import assert from "node:assert/strict";
import { closeEmoji } from "./emoji.ts";

test("a whole name becomes its emoji at the cursor", () => {
  assert.deepEqual(closeEmoji("yayy :joy:", 10), { text: "yayy 😂", cursor: "yayy 😂".length });
  assert.deepEqual(closeEmoji(":tada:", 6), { text: "🎉", cursor: "🎉".length });
  assert.deepEqual(closeEmoji(":JOY: then", 5), { text: "😂 then", cursor: "😂".length });
});

test("anything that is not an exact name stays as typed", () => {
  for (const [text, at] of [["10:30:", 6], ["http://x:", 9], [":nosuch:", 8], ["a:joy:", 6], [":joy", 4]] as const) assert.equal(closeEmoji(text, at), null, text);
});
