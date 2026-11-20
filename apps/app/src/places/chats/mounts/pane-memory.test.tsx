// The pane of a chat is the chat's own, closed as well as open (NAV R5): a chat left with its pane closed comes back closed even when the chat shown in between had its pane open, in a place that was shown again after
// being kept, and with two kept places side by side.
import test from "node:test";
import assert from "node:assert/strict";
import { act, useState } from "react";
import type { ReactElement } from "react";
import { createRoot } from "test-renderer";
import { flush, installDom } from "../../../../../../ui/src/testing/dom.ts";
import { PANE_MEMORY, forgetPanes, usePaneMemory } from "./pane-memory.ts";

type Ctl = {
  open(chat: string, pane?: boolean): void;
  toggle(): void;
  chat(): string | null;
  pane(): boolean;
  sets: boolean[];
};

/** A place the way ChatsMounted holds it: the chat on screen and its pane flag in one state, `open(chat, true)` is a chat opened with its pane (a.pane), and the memory writes through setPane. */
function Place({ start, ctl, pane0 = false }: { start: string; ctl: Ctl; pane0?: boolean }): ReactElement | null {
  const [s, setS] = useState<{ chat: string | null; pane: boolean }>({ chat: start, pane: pane0 });
  ctl.open = (chat, pane) => setS((p) => ({ chat, pane: pane === true ? true : p.pane })); // a chat comes in with the last chat's flag unless it asks for the pane
  ctl.toggle = () => setS((p) => ({ ...p, pane: !p.pane }));
  ctl.chat = () => s.chat;
  ctl.pane = () => s.pane;
  usePaneMemory({
    chat: s.chat,
    pane: s.pane,
    tab: undefined,
    arrive: () => undefined,
    setPane: (open) => {
      ctl.sets.push(open);
      setS((p) => ({ ...p, pane: open }));
    },
  });
  return null;
}
const ctl = (): Ctl => ({ open() {}, toggle() {}, chat: () => null, pane: () => false, sets: [] });
const settle = async (): Promise<void> => {
  await flush();
  await flush();
};

test("a chat left with its pane closed comes back closed after a chat that opened its pane; that chat's pane comes back open", async () => {
  const undo = installDom();
  try {
    forgetPanes();
    const c = ctl();
    const r = createRoot();
    await act(async () => r.render(<Place start="plans" ctl={c} />));
    await settle();
    assert.equal(c.pane(), false);
    await act(async () => c.open("assistant", true)); // the other chat comes in with its pane open
    await settle();
    assert.equal(c.pane(), true, "its own pane is open");
    assert.deepEqual(PANE_MEMORY.get("plans"), { open: false }, "Plans was left closed, and that was written down");
    await act(async () => c.open("plans")); // Back: the flag it arrives with is the assistant's open one
    await settle();
    assert.equal(c.pane(), false, "Plans comes back closed");
    await act(async () => c.open("assistant"));
    await settle();
    assert.equal(c.pane(), true, "and the assistant's pane comes back open");
    await act(async () => r.unmount());
  } finally {
    undo();
  }
});

test("a chat with nothing written keeps the flag it arrives with; a pane toggled on a chat is its own from then on", async () => {
  const undo = installDom();
  try {
    forgetPanes();
    const c = ctl();
    const r = createRoot();
    await act(async () => r.render(<Place start="a" ctl={c} pane0 />));
    await settle();
    await act(async () => c.open("b")); // nothing written for b: it keeps what it arrives with (open)
    await settle();
    assert.equal(c.pane(), true);
    await act(async () => c.toggle()); // b's pane is closed by the person
    await settle();
    await act(async () => c.open("a")); // a was left open
    await settle();
    assert.equal(c.pane(), true);
    await act(async () => c.open("b"));
    await settle();
    assert.equal(c.pane(), false, "b was closed by the person and stays closed");
    await act(async () => r.unmount());
  } finally {
    undo();
  }
});

test("a place shown again after being kept (its effects start again) leaves the pane as it is, with no pane action", async () => {
  const undo = installDom();
  try {
    forgetPanes();
    PANE_MEMORY.set("x", { open: true });
    PANE_MEMORY.set("y", { open: false });
    const cx = ctl();
    const cy = ctl();
    const r1 = createRoot();
    const r2 = createRoot();
    // two kept places: X (pane open on its chat) and Y (pane closed on its chat), each in its own root
    await act(async () => {
      r1.render(<Place start="x" ctl={cx} pane0 />);
      r2.render(<Place start="y" ctl={cy} />);
    });
    await settle();
    assert.equal(cx.pane(), true);
    assert.equal(cy.pane(), false);
    // Y is hidden and shown again: its effects run again with the same chat
    await act(async () => r2.unmount());
    const cy2 = ctl();
    const r3 = createRoot();
    await act(async () => r3.render(<Place start="y" ctl={cy2} />));
    await settle();
    assert.equal(cy2.pane(), false, "Y's pane is its own: closed");
    assert.deepEqual(cy2.sets, [], "no pane action when nothing changed");
    assert.equal(cx.pane(), true, "and X's pane is not touched by Y");
    // the visible one's pane opens and closes on its own
    await act(async () => cx.toggle());
    await settle();
    assert.equal(cx.pane(), false);
    assert.deepEqual(PANE_MEMORY.get("y"), { open: false });
    await act(async () => {
      r1.unmount();
      r3.unmount();
    });
  } finally {
    undo();
  }
});
