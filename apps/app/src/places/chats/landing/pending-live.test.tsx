// The agent's words stream into the opening chat the moment they exist, before the conversation has loaded: the same live frames the conversation reads, drawn by the pending view.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { flush, installDom, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { find } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { createTurnStreams } from "../../../shell/session/turn-streams.ts";
import { View, Text } from "react-native";
import { PendingChat } from "./PendingChat.tsx";

const f = (delta: Record<string, unknown>) => ({ t: "turn", turn: "trn_1", delta: { threadId: "thr_a", agentId: "agt_x", ...delta } });

test("before any frame it says it is thinking; its first words show as they arrive, with no conversation loaded", async () => {
  const off = installDom();
  let unmount: () => Promise<void> = async () => undefined;
  try {
    const turns = createTurnStreams();
    const r = createRoot();
    unmount = () => act(async () => { r.unmount(); });
    await act(async () => { r.render(<PendingChat title="Plan" text="Plan the week" files={[]} lead="Assistant" phase="sending" live={{ turns, threadId: "thr_a" }} />); });
    const root = r.container as unknown as Node;
    assert.match(textOf(root), /Assistant is thinking/);
    await act(async () => { turns.onFrame(f({ kind: "start" })); turns.onFrame(f({ kind: "delta", text: "First words of the plan" })); });
    await flush();
    assert.match(textOf(root), /First words of the plan/);
    assert.ok(find(root, "pending-turn-trn_1"), "the turn has a row of its own");
    assert.match(textOf(find(root, "msg-pending")!), /Plan the week/, "his message stays above it");
  } finally { await unmount(); off(); }
});

test("words that arrived before the chat had an id are there when the pending view starts to follow it", async () => {
  const off = installDom();
  let unmount: () => Promise<void> = async () => undefined;
  try {
    const turns = createTurnStreams();
    turns.onFrame(f({ kind: "start" })); turns.onFrame(f({ kind: "delta", text: "Already written" }));
    const r = createRoot();
    unmount = () => act(async () => { r.unmount(); });
    await act(async () => { r.render(<PendingChat title="Plan" text="Plan" files={[]} lead="Assistant" phase="sending" live={{ turns, threadId: "thr_a" }} />); });
    await flush();
    assert.match(textOf(r.container as unknown as Node), /Already written/);
  } finally { await unmount(); off(); }
});

test("before the chat has an id its reply is found by who asked and when: the words show while chat.start is still out, and another person's turn does not", async () => {
  const off = installDom();
  let unmount: () => Promise<void> = async () => undefined;
  try {
    let clock = 1_000;
    const turns = createTurnStreams({ now: () => clock });
    const r = createRoot();
    unmount = () => act(async () => { r.unmount(); });
    await act(async () => { r.render(<PendingChat title="Plan" text="Plan the week" files={[]} lead="Assistant" phase="sending" live={{ turns, asker: "usr_me", since: 2_000 }} />); });
    const root = r.container as unknown as Node;
    clock = 500; // a turn from before the press
    await act(async () => { turns.onFrame({ t: "turn", turn: "trn_old", delta: { threadId: "thr_old", agentId: "agt_x", kind: "start", asker: "usr_me" } }); turns.onFrame({ t: "turn", turn: "trn_old", delta: { threadId: "thr_old", agentId: "agt_x", kind: "delta", text: "Old chat words" } }); });
    clock = 2_500;
    await act(async () => { turns.onFrame({ t: "turn", turn: "trn_other", delta: { threadId: "thr_o", agentId: "agt_x", kind: "start", asker: "usr_you" } }); turns.onFrame({ t: "turn", turn: "trn_other", delta: { threadId: "thr_o", agentId: "agt_x", kind: "delta", text: "Someone else's words" } }); });
    await flush();
    assert.doesNotMatch(textOf(root), /Old chat words|Someone else/);
    await act(async () => { turns.onFrame({ t: "turn", turn: "trn_new", delta: { threadId: "thr_new", agentId: "agt_x", kind: "start", asker: "usr_me" } }); turns.onFrame({ t: "turn", turn: "trn_new", delta: { threadId: "thr_new", agentId: "agt_x", kind: "delta", text: "The plan starts here" } }); });
    await flush();
    assert.match(textOf(root), /The plan starts here/);
  } finally { await unmount(); off(); }
});

test("a chat he just made whose first read is refused (not found, permission) keeps showing his message and asks again; after the grace it is its own failed state with Retry and Discard, never the refusal screen", async () => {
  const { OpeningGuard } = await import("./PendingChat.tsx");
  const { holdPending, releasePending } = await import("./pending.ts");
  const off = installDom();
  let unmount: () => Promise<void> = async () => undefined;
  try {
    let clock = 100_000;
    const realNow = Date.now;
    Date.now = () => clock;
    holdPending("thr_just", { title: "Plan", text: "Plan the week", files: [], lead: "Assistant" });
    const refusal = <View testID="conversation-failed"><Text>You can't open this chat</Text></View>;
    const r = createRoot();
    unmount = () => act(async () => { r.unmount(); });
    await act(async () => { r.render(<OpeningGuard threadId="thr_just" now={() => clock}>{refusal}</OpeningGuard>); });
    const root = r.container as unknown as Node;
    assert.ok(find(root, "msg-pending"), "his message shows");
    assert.equal(find(root, "conversation-failed"), null, "the refusal does not show in the first seconds");
    assert.doesNotMatch(textOf(root), /can't open/);
    clock += 12_000;
    await act(async () => { r.render(<OpeningGuard threadId="thr_just" now={() => clock}>{refusal}</OpeningGuard>); await new Promise((res) => setTimeout(res, 1600)); });
    assert.ok(find(root, "landing-failed"), "after a sane wait: its own failed state");
    assert.ok(find(root, "landing-retry") && find(root, "landing-discard"), "with Retry and Discard");
    assert.equal(find(root, "conversation-failed"), null, "still not the refusal");
    releasePending("thr_just");
    Date.now = realNow;
  } finally { await unmount(); off(); }
});

test("a chat this window did not just make shows the page's own failure as before", async () => {
  const { OpeningGuard } = await import("./PendingChat.tsx");
  const off = installDom();
  let unmount: () => Promise<void> = async () => undefined;
  try {
    const r = createRoot();
    unmount = () => act(async () => { r.unmount(); });
    await act(async () => { r.render(<OpeningGuard threadId="thr_old"><View testID="conversation-failed"><Text>You can't open this chat</Text></View></OpeningGuard>); });
    assert.ok(find(r.container as unknown as Node, "conversation-failed"));
  } finally { await unmount(); off(); }
});
