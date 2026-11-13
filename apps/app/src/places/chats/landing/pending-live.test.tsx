// The agent's words stream into the opening chat the moment they exist, before the conversation has loaded: the same live frames the conversation reads, drawn by the pending view.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { flush, installDom, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { find } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { createTurnStreams } from "../../../shell/session/turn-streams.ts";
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
