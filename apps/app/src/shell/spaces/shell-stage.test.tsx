// F55: every screen the shell draws itself (a failure, a new tab, a place that needs a Team Space) says the app is usable, so the launch frame leaves at once instead of waiting out its 8 s cap.
// The skeleton and a place the shell hands to a place module do not: that module marks it once it has drawn. A fifth screen drawn here that forgets the mark fails the table below.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import type { ReactElement } from "react";
import { Text } from "react-native";
import { installDom, mount } from "../../../../../ui/src/testing/dom.ts";
import type { PlaceContext } from "./model.ts";
import { ShellStage } from "./Shell.tsx";

type Stage = Parameters<typeof ShellStage>[0];
const hub = { placeDrawn: (): void => undefined, retry: (): void => undefined };
const ctx = {
  spaceId: "s1",
  spaceName: "Home",
  kind: "personal",
  place: "chats",
  hash: "",
  epoch: 1,
} as unknown as PlaceContext;
const base: Stage = {
  hub,
  state: { phase: "ready", error: null, epoch: 1, place: "chats", hash: "" },
  spaceName: "Home",
  kind: "personal",
  ctx,
  activeTab: undefined,
  compact: false,
  renderPlace: () => <Text>The place</Text>,
};

async function usableCount(stage: Stage): Promise<number> {
  const restore = installDom();
  const g = globalThis as unknown as {
    addEventListener?: unknown;
    removeEventListener?: unknown;
    dispatchEvent?: unknown;
    Event?: unknown;
    performance?: { mark?: (n: string) => unknown };
  };
  const keep = { a: g.addEventListener, r: g.removeEventListener, d: g.dispatchEvent, e: g.Event };
  let n = 0;
  g.Event = class {
    constructor(public type: string) {}
  };
  g.dispatchEvent = (e: { type: string }) => (e.type === "vyre:usable" && n++, true);
  try {
    await mount(createRoot as never, (<ShellStage {...stage} />) as ReactElement);
    return n;
  } finally {
    g.addEventListener = keep.a;
    g.removeEventListener = keep.r;
    g.dispatchEvent = keep.d;
    g.Event = keep.e;
    restore();
  }
}

test("a failure, a new tab and a place that needs a Team Space each mark the app usable on mount", async () => {
  const drawn: [string, Stage][] = [
    ["failure", { ...base, state: { ...base.state, error: "offline" } }],
    ["new tab", { ...base, activeTab: { key: "t1", isNew: true } }],
    ["needs a Team Space", { ...base, state: { ...base.state, place: "apps" } }],
  ];
  for (const [name, stage] of drawn) assert.ok((await usableCount(stage)) >= 1, `${name} says the app is usable`);
});

test("the skeleton and a plain place do not mark it: a place module does that once it has drawn", async () => {
  assert.equal(await usableCount({ ...base, state: { ...base.state, phase: "skeleton" } }), 0, "skeleton");
  assert.equal(await usableCount(base), 0, "a place handed to renderPlace");
});
