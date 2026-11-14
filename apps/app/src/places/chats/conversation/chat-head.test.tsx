// The open chat's head and stop at the Conversation level (r-kinds-a2 and r-ui, 14 Nov): the housekeeping behind "More" says Leave for a chat with only people and Delete for a chat with an agent, and the composer's stop
// stops the agent that was chosen, everyone only by "Stop everyone", and the one agent at once where only one works.
import test from "node:test";
import assert from "node:assert/strict";
import { Dimensions } from "react-native";
import { createRoot } from "test-renderer";
import { installDom, mount, find, flush, press, textOf } from "../../../onboarding/test-dom.ts";
import { Conversation } from "./Conversation.tsx";
import { InProjectFrame, createFrameStore } from "./frame.ts";
import { createSample } from "./sample.ts";

const wide = (): void => {
  installDom();
  Dimensions.set({ window: { width: 1280, height: 844, scale: 1, fontScale: 1 } });
};

let headLabels: string[] = [];
async function openMore(s: ReturnType<typeof createSample>): Promise<string> {
  const store = createFrameStore();
  const root = await mount(
    createRoot,
    <InProjectFrame value={store}>
      <Conversation data={s.data} />
    </InProjectFrame>,
  );
  await flush();
  const entries = store.get()!.chatEntries();
  headLabels = entries.flatMap((e) => ("label" in e ? [e.label] : []));
  const more = entries.find((e) => "label" in e && e.label === "More") as { onSelect(): void } | undefined;
  assert.ok(more, "the head menu closes with More");
  more.onSelect();
  await flush();
  return textOf(root);
}

test("More in a chat with an agent offers Delete chat, never Leave; in a chat with only people it offers Leave chat, never Delete", async () => {
  wide();
  const withAgent = await openMore(createSample("idle"));
  assert.ok(withAgent.includes("Delete chat") && !withAgent.includes("Leave chat"), withAgent);
  assert.ok(
    headLabels.includes("Plan first") && !headLabels.includes("Mute"),
    `an agent chat has no Mute in the head: ${headLabels.join(", ")}`,
  );
  assert.ok(withAgent.includes("Star") && withAgent.includes("Copy Link") && withAgent.includes("Add People"));
  const s = createSample("idle");
  await s.data.call("threads.remove_agent", { threadId: "c1", agentId: "agt_intake" });
  await s.data.call("threads.remove_agent", { threadId: "c1", agentId: "agt_docs" });
  await s.data.call("threads.members.add", { threadId: "c1", personId: "usr_maya" });
  const people = await openMore(s);
  assert.ok(people.includes("Leave chat") && !people.includes("Delete chat"), people);
  assert.ok(headLabels.includes("Mute"), `a chat with only people has Mute in the head: ${headLabels.join(", ")}`);
});

const stopCalls = (s: ReturnType<typeof createSample>): { cap: string; input: Record<string, unknown> }[] =>
  (s.calls as { cap: string; input: Record<string, unknown> }[]).filter(
    (c) => c.cap === "engine.stop" || c.cap === "engine.stop_all",
  );

test("with two agents working the composer's stop opens a choice: Stop <name> stops that agent only, Stop everyone stops all", async () => {
  wide();
  for (const pick of ["Stop Docs", "Stop Intake", "Stop everyone"]) {
    const s = createSample("busy");
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await flush();
    await press(find(root, "composer-send"));
    await flush();
    assert.ok(
      find(root, "menu-item-Stop Intake") && find(root, "menu-item-Stop Docs") && find(root, "menu-item-Stop everyone"),
      "the choice",
    );
    assert.deepEqual(stopCalls(s), [], "nothing stopped by opening it");
    await press(find(root, `menu-item-${pick}`));
    await flush();
    const got = stopCalls(s);
    assert.equal(got.length, 1, pick);
    if (pick === "Stop everyone") assert.equal(got[0]!.cap, "engine.stop_all");
    else {
      assert.equal(got[0]!.cap, "engine.stop", pick);
      assert.equal(got[0]!.input["agentId"], pick === "Stop Docs" ? "agt_docs" : "agt_intake");
    }
  }
});

test("with one agent working the composer's stop stops it at once, with no choice", async () => {
  wide();
  const s = createSample("streaming");
  const root = await mount(createRoot, <Conversation data={s.data} />);
  await flush();
  await press(find(root, "composer-send"));
  await flush();
  assert.equal(find(root, "menu-item-Stop everyone"), null, "no menu for one agent");
  const got = stopCalls(s);
  assert.equal(got.length, 1);
  assert.equal(got[0]!.cap, "engine.stop");
  assert.equal(got[0]!.input["agentId"], "agt_intake");
});

test("a channel's head menu has no Mute and no Archive (they are the channel's own, in More and in the sidebar), and More still closes it", async () => {
  wide();
  await openMore(createSample("channel"));
  assert.ok(!headLabels.includes("Mute") && !headLabels.includes("Archive"), headLabels.join(", "));
  assert.ok(headLabels.includes("More") && headLabels.includes("Find in this chat"));
});
