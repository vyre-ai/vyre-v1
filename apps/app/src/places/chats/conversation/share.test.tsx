import test from "node:test";
import assert from "node:assert/strict";
import { shareTargets, shareTo } from "./actions.ts";
import type { ConversationData } from "./data.tsx";

function data(): { d: ConversationData; calls: Array<[string, any]> } {
  const calls: Array<[string, any]> = [];
  const d = {
    me: { id: "usr_me", name: "Me" },
    directory: [{ id: "usr_me", name: "Me", kind: "person" }, { id: "usr_maya", name: "Maya Chen", kind: "person" }, { id: "agt_x", name: "Billing", kind: "agent" }],
    call: async (cap: string, input: any) => {
      calls.push([cap, input]);
      if (cap === "channels.list") return { channels: [{ name: "ops", mainThreadId: "thr_ops", archived: false }, { name: "old", mainThreadId: "thr_old", archived: true }, { name: "here", mainThreadId: "thr_here", archived: false }] };
      if (cap === "chat.start") return { thread: { threadId: "thr_maya" } };
      return {};
    },
  } as unknown as ConversationData;
  return { d, calls };
}

test("the places to share to are the live channels and the other people, never this chat, an archived channel, yourself or an agent", async () => {
  const { d } = data();
  assert.deepEqual((await shareTargets(d, "thr_here")).map((x) => x.label), ["#ops", "Maya Chen"]);
});

test("sharing to a channel calls chat.share with its main chat; to a person it first makes sure there is a chat with them", async () => {
  const { d, calls } = data();
  await shareTo(d, "thr_a", "msg_1", { label: "#ops", threadId: "thr_ops" }, "k1");
  assert.deepEqual(calls.at(-1), ["chat.share", { threadId: "thr_a", messageId: "msg_1", toThreadId: "thr_ops", to: "#ops", idempotencyKey: "k1" }]);
  await shareTo(d, "thr_a", "msg_1", { label: "Maya Chen", personId: "usr_maya" }, "k2");
  assert.equal(calls.at(-2)![0], "chat.start");
  assert.deepEqual(calls.at(-1), ["chat.share", { threadId: "thr_a", messageId: "msg_1", toThreadId: "thr_maya", to: "usr_maya", idempotencyKey: "k2" }]);
});
