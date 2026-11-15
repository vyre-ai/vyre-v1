// The sidebar column keeps its room between two places (team/v1/TABS-2026-11-15.md; owner, 15 Nov 2026: switching tabs must not blink).
// A place that leaves does not take the column with it at once: the next place fills it in the same commit, and only a place with no list lets it go, after a short hold.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import type { ReactElement } from "react";
import { flush, installDom } from "../../../../../ui/src/testing/dom.ts";
import { SIDEBAR_HOLD_MS, SidebarContent, SidebarSlotProvider, useInSidebarSlot, useSidebarSlot } from "./index.ts";

const props = { deviceId: "d1", personId: "p1", spaceId: "northwind", place: "chats", epoch: 1, compact: false };
const seen: { has: boolean; title: string }[] = [];
let inSlot: boolean | null = null;
function Probe(): null {
  const s = useSidebarSlot();
  seen.push({ has: s.hasSidebar, title: s.title });
  return null;
}
function Alone(): null {
  inSlot = useInSidebarSlot();
  return null;
}
function App({ place }: { place: "chats" | "console" | "home" }): ReactElement {
  return (
    <SidebarSlotProvider {...props}>
      <Probe />
      {place === "home" ? null : (
        <SidebarContent key={place} title={place === "chats" ? "Chats" : "Console"} noSearch>
          {() => null}
        </SidebarContent>
      )}
    </SidebarSlotProvider>
  );
}
const last = (): { has: boolean; title: string } => seen[seen.length - 1]!;
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test("from one place with a list to another, the column is never absent: no render between them says there is no sidebar", async () => {
  const restore = installDom();
  try {
    const r = createRoot();
    await act(async () => r.render(<App place="chats" />));
    await flush();
    assert.deepEqual(last(), { has: true, title: "Chats" });
    seen.length = 0;
    await act(async () => r.render(<App place="console" />));
    await flush();
    assert.deepEqual(last(), { has: true, title: "Console" });
    assert.equal(
      seen.some((x) => !x.has),
      false,
      `every render in the switch kept the column: ${JSON.stringify(seen)}`,
    );
    await act(async () => wait(SIDEBAR_HOLD_MS + 80));
    assert.deepEqual(
      last(),
      { has: true, title: "Console" },
      "the hold running out does not take a column a place is using",
    );
  } finally {
    restore();
  }
});

test("a place with no list: the column keeps its room, empty, for the hold, then goes", async () => {
  const restore = installDom();
  try {
    const r = createRoot();
    await act(async () => r.render(<App place="chats" />));
    await flush();
    await act(async () => r.render(<App place="home" />));
    await flush();
    assert.deepEqual(last(), { has: true, title: "" }, "held: the room is kept, the old place's name is not shown");
    await act(async () => wait(SIDEBAR_HOLD_MS + 80));
    await flush();
    assert.deepEqual(last(), { has: false, title: "" }, "after the hold the column is gone");
    await act(async () => r.render(<App place="console" />));
    await flush();
    assert.deepEqual(last(), { has: true, title: "Console" }, "and it comes back for the next place that has one");
  } finally {
    restore();
  }
});

test("a place can tell whether a shell column exists to draw in", async () => {
  const restore = installDom();
  try {
    const r = createRoot();
    await act(async () => r.render(<Alone />));
    assert.equal(inSlot, false, "standing alone: draw your own list");
    await act(async () =>
      r.render(
        <SidebarSlotProvider {...props}>
          <Alone />
        </SidebarSlotProvider>,
      ),
    );
    assert.equal(inSlot, true);
  } finally {
    restore();
  }
});
