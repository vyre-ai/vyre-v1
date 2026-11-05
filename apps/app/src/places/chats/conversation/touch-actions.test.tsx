// @tsx
// A message's actions follow what the device can do: where it hovers the bar shows, where it cannot (a tablet, a phone) a long press opens the sheet. Both are live: a device that gains or loses a way to
// hover (an iPad with a trackpad, a touch laptop folded into a tablet) switches when the media query changes, with no reload, and a device that hovers and has a touch screen has both.
import test from "node:test";
import assert from "node:assert/strict";
import { act as reactAct } from "react";
import { createRoot } from "test-renderer";
import { find, installDom, mount, textOf } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { createSample } from "./sample.ts";
import { MessageView } from "./MessageView.tsx";
import { timeline } from "./model.ts";
import type { Message } from "./model.ts";

type Listener = () => void;
/** A matchMedia that answers (hover: none) from `hoverNone` and tells its listeners when the test changes it. */
function media(hoverNone: boolean) {
  const listeners = new Set<Listener>();
  const state = { hoverNone, added: 0, removed: 0 };
  const mm = (q: string) => ({
    get matches() { return q.includes("hover: none") ? state.hoverNone : false; },
    addEventListener: (_t: string, f: Listener) => { state.added++; listeners.add(f); },
    removeEventListener: (_t: string, f: Listener) => { state.removed++; listeners.delete(f); },
  });
  return { state, mm, set: async (v: boolean) => { state.hoverNone = v; await reactAct(async () => { for (const f of [...listeners]) f(); }); } };
}

const reply: Message = { messageId: "m_ans", threadId: "thr_1", threadSeq: 2, author: { kind: "agent", id: "agt_billing" }, kind: "agent", body: "Three invoices are paid, two are open.", blocks: [], createdAt: 2, reactions: [], pinned: false } as unknown as Message;

async function rig(m: ReturnType<typeof media>) {
  const restore = installDom();
  (globalThis as { matchMedia?: unknown }).matchMedia = m.mm;
  const s = createSample("idle");
  const items = timeline([reply], { meId: s.data.me.id, nameOf: s.data.nameOf, kindOf: s.data.kindOf, clock: s.data.clock() });
  const actions = { openBeside: () => undefined, nameOf: s.data.nameOf, makeTask: () => undefined, copy: () => undefined, openThread: () => undefined, setPinned: () => undefined, fork: () => undefined, showMenu: () => undefined, remove: () => undefined, react: () => undefined } as never;
  const root = await mount(createRoot as never, <MessageView item={items.find((i) => (i as { message?: Message }).message?.messageId === "m_ans")!} actions={actions} meId={s.data.me.id} />);
  return { root, restore };
}

/** The first node that carries a touch-start handler: the row a finger presses. */
const rowOf = (n: Node): Node | null => {
  if (typeof n.props["onTouchStart"] === "function") return n;
  for (const c of n.children ?? []) { if (typeof c === "string") continue; const f = rowOf(c); if (f) return f; }
  return null;
};
const longPress = async (root: Node): Promise<void> => {
  const row = rowOf(root);
  assert.ok(row, "the message row listens for a touch");
  await reactAct(async () => { (row.props["onTouchStart"] as () => void)(); await new Promise((r) => setTimeout(r, 520)); });
};

test("a device that hovers and has a touch screen has both: the bar is there, and a long press opens the sheet", async () => {
  const m = media(false);
  const { root, restore } = await rig(m);
  try {
    assert.ok(find(root, "hover-m_ans"), "the hover bar is drawn where the device hovers");
    assert.ok(!textOf(root).includes("Make a Task"), "no sheet at rest");
    await longPress(root);
    assert.ok(textOf(root).includes("Make a Task"), "the long press opened the sheet with Make a Task");
    assert.ok(find(root, "hover-m_ans"), "and the hover bar is still there");
  } finally { restore(); }
});

test("when the device stops being able to hover the bar goes away, and comes back when it can again, live and on the same row", async () => {
  const m = media(false);
  const { root, restore } = await rig(m);
  try {
    assert.equal(m.state.added, 1, "one listener for the media query");
    const before = textOf(root);
    assert.ok(find(root, "hover-m_ans"), "bar while it hovers");
    await m.set(true);
    assert.equal(find(root, "hover-m_ans"), null, "the bar is gone once hover is none");
    assert.ok(textOf(root).includes("Three invoices are paid"), "the message itself stays, not remounted into nothing");
    assert.equal(m.state.added, 1, "the same listener: the row was not mounted again");
    await longPress(root);
    assert.ok(textOf(root).includes("Make a Task"), "and a long press opens the sheet");
    await m.set(false);
    assert.ok(find(root, "hover-m_ans"), "the bar comes back when the device can hover again");
    assert.equal(textOf(root).includes("Three invoices"), before.includes("Three invoices"));
  } finally { restore(); }
});
