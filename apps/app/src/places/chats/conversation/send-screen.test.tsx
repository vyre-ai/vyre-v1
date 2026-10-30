// A message sent in an Ask pane carries the screen the person came from; a message in a plain chat does not.
import test from "node:test";
import assert from "node:assert/strict";
import { sendMessage } from "./actions.ts";
import type { ConversationData } from "./data.tsx";
import { noteThreadKind, screenFromHash, setScreenContext } from "../../../shell/ask/screen.ts";

const data = (threadId: string, posts: unknown[]): ConversationData => ({
  threadId,
  call: async (cap: string, input: unknown) => { posts.push({ cap, input }); return { message: { messageId: "msg_1", threadSeq: 1 } }; },
}) as unknown as ConversationData;
const send = (d: ConversationData) => sendMessage(d, { text: "who is this?", mentions: [], key: "k1", kind: "send", working: false });

test("an Ask pane's message carries where the person is", async () => {
  setScreenContext(screenFromHash("records", "screen=records.record-page&subject=record%3Arec_a1"));
  noteThreadKind("thr_ask", "ask");
  const posts: Array<{ cap: string; input: { screen?: { place: string; open?: unknown[] } } }> = [];
  await send(data("thr_ask", posts));
  assert.equal(posts[0]!.cap, "chat.post");
  assert.equal(posts[0]!.input.screen?.place, "records");
  assert.deepEqual(posts[0]!.input.screen?.open, [{ type: "record", id: "rec_a1" }]);
});

test("a plain chat's message carries no screen, and neither does an Ask when the person is nowhere", async () => {
  setScreenContext(screenFromHash("records", ""));
  noteThreadKind("thr_chat", "chat");
  const posts: Array<{ cap: string; input: Record<string, unknown> }> = [];
  await send(data("thr_chat", posts));
  assert.equal("screen" in posts[0]!.input, false);
  setScreenContext(null);
  noteThreadKind("thr_ask2", "ask");
  await send(data("thr_ask2", posts));
  assert.equal("screen" in posts[1]!.input, false);
});
