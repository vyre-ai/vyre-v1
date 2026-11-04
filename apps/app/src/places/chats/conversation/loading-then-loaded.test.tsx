// A chat that finishes loading (lane l-chrome2a, 5 Nov): the conversation draws its loading frame first and the real page after, and it must do so without a hooks-order error (React 310: a hook after
// an early return changes the hook count the moment the chat loads). In a project's frame and in plain Chats. This is the test that would have caught 670f274d8.
import test from "node:test";
import assert from "node:assert/strict";
import { Dimensions } from "react-native";
import { act } from "react";
import { createRoot } from "test-renderer";
import { installDom, mount, find, flush } from "../../../onboarding/test-dom.ts";
import { Conversation } from "./Conversation.tsx";
import { InProjectFrame, createFrameStore } from "./frame.ts";
import { createSample } from "./sample.ts";

const LOADING = { status: "loading" } as const;

/** The sample's data with its live queries held in "loading" until `release()`: the way a chat arrives from a Space. */
function held() {
  const s = createSample("idle");
  let released = false;
  const listeners = new Set<() => void>();
  const real = s.data.screens;
  const screens = {
    ...real,
    query(id: string, name: string, state: Record<string, unknown>) {
      const q = real.query(id, name, state) as { getSnapshot(): unknown; subscribe(l: () => void): () => void };
      return {
        ...q,
        getSnapshot: () => (released ? q.getSnapshot() : LOADING),
        subscribe: (l: () => void) => { listeners.add(l); const off = q.subscribe(l); return () => { listeners.delete(l); off(); }; },
      };
    },
  };
  return { data: { ...s.data, screens } as typeof s.data, release: async () => { released = true; await act(async () => { for (const l of [...listeners]) l(); }); await flush(); } };
}

const errors: string[] = [];
const origError = console.error;

for (const framed of [false, true]) {
  test(`a chat finishing loading draws without a hooks error, ${framed ? "in a project's frame" : "in plain Chats"}`, async () => {
    installDom();
    Dimensions.set({ window: { width: 1280, height: 844, scale: 1, fontScale: 1 } });
    errors.length = 0;
    console.error = (...a: unknown[]) => { errors.push(a.map(String).join(" ")); };
    try {
      const h = held();
      const store = createFrameStore();
      const el = framed ? <InProjectFrame value={store}><Conversation data={h.data} /></InProjectFrame> : <Conversation data={h.data} />;
      const root = await mount(createRoot, el);
      await flush();
      assert.equal(find(root, "conversation"), null, "still loading: the frame, not the page");
      await h.release();
      await flush();
      assert.ok(find(root, "conversation"), "the page is drawn once the chat has loaded");
      assert.equal(find(root, "conversation-head") !== null, !framed, framed ? "the project's header is the only one" : "plain Chats keeps its header");
      if (framed) assert.ok(store.get(), "the frame got the conversation's controls after it loaded");
      const bad = errors.filter((e) => /Rendered (more|fewer) hooks|Invalid hook call|React error #310|Minified React error/i.test(e));
      assert.deepEqual(bad, [], "no hooks-order error");
    } finally { console.error = origError; }
  });
}
