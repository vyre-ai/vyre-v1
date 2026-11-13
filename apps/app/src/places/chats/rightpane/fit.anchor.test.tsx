// The More menu of a tab strip opens under the control that was pressed (owner, rc.26, 13 Nov 2026: it opened at the top right of the pane, over the agent's name and Share, far from the three dots). The
// strip used to place it from a window position worked out from the tabs' widths and a fixed row (118 px, or 330 on the agent page), which is only right for one layout.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { MORE_KEY } from "./model.ts";
import { useFittedTabs } from "./fit.tsx";
import type { FitMenu } from "./fit.tsx";

const TABS = ["About", "Computer", "Chats", "Files", "Terminal", "Knows", "Routines"].map((t) => ({ key: t.toLowerCase(), title: t }));

type Doc = { body: object; activeElement: { getBoundingClientRect(): { left: number; bottom: number; width: number; height: number } } | object };
function withDocument<T>(doc: Doc | undefined, f: () => T): T {
  const g = globalThis as { document?: unknown };
  const was = g.document;
  if (doc) g.document = doc; else delete g.document;
  try { return f(); } finally { if (was === undefined) delete g.document; else g.document = was; }
}

/** What the strip does when More is pressed at this pane width: where it asks the menu to open. */
function pressMore(doc: Doc | undefined, o: { left: number; top: number }): { x: number; y: number; labels: string[] } | null {
  let shown: { x: number; y: number; labels: string[] } | null = null;
  const menu: FitMenu = { show: (entries, x, y) => { shown = { x, y, labels: entries.map((e) => ("label" in e ? e.label : "")) }; } };
  function Probe(): null {
    const { select } = useFittedTabs(TABS, "about", 340, { menu, left: o.left, top: o.top, pick: () => undefined });
    withDocument(doc, () => select(MORE_KEY));
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return shown;
}

test("More opens just under the control that was pressed, wherever the strip is on the window", () => {
  const control = { getBoundingClientRect: () => ({ left: 301, bottom: 258, width: 28, height: 30 }) };
  const at = pressMore({ body: {}, activeElement: control }, { left: 40, top: 118 });
  assert.ok(at, "the menu was opened");
  assert.deepEqual([at.x, at.y], [301, 262], "left edge of the control, a few pixels under it, not the strip's fixed row");
  assert.ok(at.labels.includes("Routines"), "it lists the folded tabs");
  // the same strip somewhere else (the agent page puts it at 330 px): the menu follows the control, not the number
  const again = pressMore({ body: {}, activeElement: { getBoundingClientRect: () => ({ left: 640, bottom: 410, width: 28, height: 30 }) } }, { left: 16, top: 330 });
  assert.deepEqual([again?.x, again?.y], [640, 414]);
});

test("with nothing focused (the page body is the active element) the menu falls back to the strip's own position, never the body's box", () => {
  const body = { getBoundingClientRect: () => ({ left: 0, bottom: 900, width: 1280, height: 900 }) };
  const at = pressMore({ body, activeElement: body } as unknown as Doc, { left: 40, top: 118 });
  assert.ok(at && at.y === 118 && at.x >= 40, `fell back to the strip's row: ${JSON.stringify(at)}`);
  const none = pressMore(undefined, { left: 40, top: 118 });
  assert.ok(none && none.y === 118, "no document at all: the fallback too");
});
