// A channel's thread lives in its channel (13 Nov 2026, lane f-guest): a thread made before that is moved under its channel by the first call that names it.
import test from "node:test";
import assert from "node:assert/strict";
import { threadHome, threadMoveInto } from "./resources.ts";

const old = { id: "thr_a", type: "thread", parent_id: "spc_x", label: 0, owner_id: "usr_o", holds: 0 } as never;

test("a thread registered under the Space moves under its channel, keeping its owner and label", () => {
  assert.deepEqual(threadMoveInto(old, "chn_a", true), {
    id: "thr_a",
    type: "thread",
    parent_id: "chn_a",
    label: 0,
    owner_id: "usr_o",
    holds: 0,
  });
});

test("nothing moves when it is not a channel's thread, the channel is unknown, or it is already there", () => {
  assert.equal(threadMoveInto(old, null, true), null);
  assert.equal(threadMoveInto(old, "chn_a", false), null);
  assert.equal(threadMoveInto({ ...(old as object), parent_id: "chn_a" } as never, "chn_a", true), null);
  assert.equal(threadMoveInto(undefined, "chn_a", true), null);
  assert.equal(threadMoveInto({ ...(old as object), type: "record" } as never, "chn_a", true), null);
});

// the table: which threads a channel's grant reaches (13 Nov 2026, lane f-guest)
const inCh = (id: string): boolean => id === "thr_main" || id === "thr_reply";
const home = (t: Partial<Parameters<typeof threadHome>[0]>) =>
  threadHome({ kind: "chat", channelId: undefined, parentThreadId: undefined, replyThread: false, ...t }, inCh);

test("a channel's chat lives in its channel, and a reply thread under a thread already in a channel lives in that thread", () => {
  assert.equal(home({ kind: "channel", channelId: "chn_a" }), "chn_a");
  assert.equal(home({ kind: "thread", parentThreadId: "thr_main", replyThread: true }), "thr_main");
  assert.equal(home({ kind: "thread", parentThreadId: "thr_reply", replyThread: true }), "thr_reply");
});

test("nothing else that hangs off or sits beside a channel is in it", () => {
  assert.equal(
    home({ kind: "thread", parentThreadId: "thr_main", replyThread: false }),
    null,
    "a handoff thread (not made by chat.thread)",
  );
  assert.equal(home({ kind: "helper", parentThreadId: "thr_main" }), null, "a helper");
  assert.equal(home({ kind: "run", parentThreadId: "thr_main" }), null, "a Run's chat");
  assert.equal(home({ kind: "chat", channelId: "chn_a" }), null, "a private chat, even one that names a channel");
  assert.equal(home({ kind: "ask", channelId: "chn_a" }), null, "an Ask pane");
  assert.equal(home({ kind: "chat" }), null, "a one-to-one, an aside, an agent's chat");
  assert.equal(
    home({ kind: "thread", parentThreadId: "thr_private", replyThread: true }),
    null,
    "a reply thread under a thread that is not in a channel",
  );
  assert.equal(home({ kind: "channel", channelId: "x; drop" }), null, "an id that is not a channel's");
});
