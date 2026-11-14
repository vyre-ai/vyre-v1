// C (review, 13 Nov 2026): a chat this person just started is not refused while its row is landing. The session notes every chat.start; Conversation asks here before it says "You can't open this chat".
// Lane f-newchat: its PendingChat must not resolve into Conversation's refusal for an id in this list; `refusalIsPending(failure, threadId)` (this folder's just-made.ts) is the call Conversation makes at the line `const notYet = ...`; PendingChat must resolve through it, not around it.
import test from "node:test";
import assert from "node:assert/strict";
import { JUST_MADE_MS, MAKES_A_THREAD, isJustMade, noteMade, refusalIsPending, threadOfStart } from "./just-made.ts";
import { refusalFinal } from "../../../../../ui/src/States/retry.ts";

const NOT_FOUND = { message: "That chat does not exist or is not yours.", code: "validation.not_found" };

test("a chat started a moment ago is pending, then final after 30 s", () => {
  noteMade("thr_new", 1_000);
  assert.equal(isJustMade("thr_new", 1_000 + 5_000), true);
  assert.equal(isJustMade("thr_new", 1_000 + JUST_MADE_MS), true);
  assert.equal(isJustMade("thr_new", 1_000 + JUST_MADE_MS + 1), false);
  assert.equal(isJustMade("thr_never_made", 1_000), false, "a chat this person did not start is never pending");
});

test("a refused read of a chat just made is not a refusal; of any other chat it is", () => {
  noteMade("thr_mine");
  assert.equal(
    refusalFinal(NOT_FOUND, isJustMade("thr_mine")),
    false,
    "pending: the loading mark shows and the read is asked again",
  );
  assert.equal(refusalFinal(NOT_FOUND, isJustMade("thr_theirs")), true);
  assert.equal(
    refusalFinal({ message: "slow", code: "timeout" }, false),
    false,
    "a transient failure is never a refusal",
  );
});

test("what a chat.start answer names", () => {
  assert.equal(threadOfStart({ thread: { threadId: "thr_1" } }), "thr_1");
  assert.equal(
    threadOfStart({ channel: { mainThreadId: "thr_main" } }),
    "thr_main",
    "a channel made by channels.create: its main thread",
  );
  assert.equal(threadOfStart({ helper: { threadId: "thr_helper" } }), "thr_helper", "a helper's thread");
  assert.deepEqual([...MAKES_A_THREAD].sort(), ["channels.create", "chat.helper.start", "chat.start"]);
  assert.equal(threadOfStart({}), null);
  assert.equal(threadOfStart(null), null);
});

test("Conversation defers to the list: refusalIsPending is true only for a refused read of a chat just made", async () => {
  noteMade("thr_pending");
  assert.equal(refusalIsPending(NOT_FOUND, "thr_pending"), true);
  assert.equal(refusalIsPending(NOT_FOUND, "thr_other"), false);
  assert.equal(refusalIsPending({ code: "internal.error" }, "thr_pending"), false);
});
