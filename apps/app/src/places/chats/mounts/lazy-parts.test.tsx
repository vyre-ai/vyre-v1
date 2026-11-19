// The parts of the Chats place that load on request never draw an empty frame (rc.41): the Crew pane's wrapper returns what was on the right until the pane is open and has arrived, the agent page's
// Trash check is in the place's own code, and a note opened from a link shows the loading mark at once.
import test from "node:test";
import assert from "node:assert/strict";
import { act, useEffect } from "react";
import { createRoot } from "test-renderer";
import { View } from "react-native";
import { find, flush, installDom, mount } from "../../../../../../ui/src/testing/dom.ts";
import { CrewProvider, useCrew } from "../crew/context.tsx";
import type { CrewCtx } from "../crew/context.tsx";
import { AgentInTrash as EagerAgentInTrash } from "../agentpage/AgentInTrash.tsx";
import { AgentInTrash, CrewSide, NotesPage, preloadChatsPages } from "./lazy-pages.tsx";

test("a note opened from a link shows the loading mark on the first frame while the editor loads", async () => {
  const undo = installDom();
  try {
    // the first frame, read before the editor's code can have arrived (this test runs before anything preloads the pages)
    const r = createRoot();
    act(() => {
      r.render(<NotesPage rt={{} as never} nameOf={() => "x"} noteId="note_1" />);
    });
    assert.ok(find(r.container as never, "notes-loading"), "the loading mark is there on the first frame");
  } finally {
    undo();
  }
});

const RIGHT = <View testID="right-before" />;
const crewCall = async (cap: string): Promise<unknown> =>
  cap === "engine.crew.status"
    ? {
        members: [
          { kind: "helper", id: "thr_a", parentThreadId: "thr_0", title: "Calendar", name: "Tess", agentId: "agt_tess", state: "working", step: "x", startedAt: 1, elapsedMs: 1, tokensIn: 1, tokensOut: 1, costMicros: 1 },
        ],
        totals: { members: 1, working: 1, done: 0, needsYou: 0, failed: 0, stopped: 0, tokensIn: 1, tokensOut: 1, costMicros: 1 },
      }
    : {};

test("the Crew wrapper returns what was on the right on the first frame, with no Crew chunk and no provider", async () => {
  const undo = installDom();
  try {
    const r = createRoot();
    act(() => {
      r.render(<CrewSide fallback={RIGHT} nameOf={() => "x"} openHelper={() => undefined} narrow={false} />);
    });
    assert.ok(find(r.container as never, "right-before"), "first frame, read before any chunk can have arrived");
  } finally {
    undo();
  }
});

test("an open Crew pane whose chunk is out shows what was on the right, then the pane, never an empty frame", async () => {
  const undo = installDom();
  try {
    let ctx: CrewCtx | null = null;
    const Probe = (): null => {
      const c = useCrew();
      useEffect(() => {
        ctx = c;
      });
      return null;
    };
    const root = await mount(
      () => createRoot(),
      <CrewProvider call={crewCall} threadId="thr_0">
        <Probe />
        <CrewSide fallback={RIGHT} nameOf={() => "x"} openHelper={() => undefined} narrow={false} />
      </CrewProvider>,
    );
    await flush();
    assert.ok(find(root, "right-before"), "closed: the right side as it was");
    act(() => {
      (ctx as CrewCtx | null)!.show(null);
    });
    // the pane's code has not arrived: the right side stands in, nothing is empty
    assert.ok(find(root, "right-before"), "the right side stands in until the pane has arrived");
    assert.equal(find(root, "crew-side"), null);
    await act(async () => {
      await preloadChatsPages();
    });
    await flush();
    assert.ok(find(root, "crew-side"), "the Crew pane is there once it has arrived");
  } finally {
    undo();
  }
});

test("the agent page's Trash check is in the place's own code: the agent page draws on the first frame", async () => {
  const undo = installDom();
  try {
    assert.equal(AgentInTrash, EagerAgentInTrash);
    const root = await mount(
      () => createRoot(),
      <AgentInTrash agentId="agt_1" call={() => new Promise(() => undefined)} fallback={<View testID="agent-page" />} />,
    );
    assert.ok(find(root, "agent-page"));
  } finally {
    undo();
  }
});

