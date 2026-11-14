// @tsx
import test from "node:test";
import assert from "node:assert/strict";
import { replyWords } from "./replies.ts";
import { timeLabel, whenLabel } from "./model.ts";

test("a thread footer and a message row say the same instant in the same words (14 Nov)", () => {
  const clock = { now: Date.UTC(2026, 10, 14, 15, 0), offsetMin: 0 };
  const at = Date.UTC(2026, 10, 14, 14, 48);
  assert.equal(timeLabel(at, clock), "2:48 PM", "what a message row shows");
  assert.equal(whenLabel(at, clock), timeLabel(at, clock), "the thread root and the pane use it too");
  const w = replyWords({ threadId: "t", count: 1, lastAt: at, people: [], unread: 0, muted: false }, clock);
  assert.equal(w.when, `Last reply ${timeLabel(at, clock)}`);
  assert.equal(whenLabel(at - 86_400_000, clock), "Yesterday", "an earlier day keeps its words");
});
