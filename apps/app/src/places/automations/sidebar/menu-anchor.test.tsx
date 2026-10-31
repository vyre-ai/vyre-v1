// The plus beside a sidebar section opens its menu under the plus, not in the window's top-left corner. The press gives the button no pointer position, so the shared Menu remembers
// the control that was pressed and anchors to it.
import test from "node:test";
import assert from "node:assert/strict";
import { Dimensions } from "react-native";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press } from "../../../../../../ui/src/testing/dom.ts";
import { noteAnchor, resetAnchor, resolveMenuPoint } from "../../../../../../ui/src/Menu/index.tsx";
import { AutomationsSidebar } from "./AutomationsSidebar.tsx";
import { AutomationsDataProvider } from "../canvas/data.tsx";
import { createSampleAutomations, northwind } from "./sample.ts";

installDom();
// the test window has no size; give it one so the menu is not squeezed into the corner
Dimensions.set({ window: { width: 1280, height: 800, scale: 1, fontScale: 1 }, screen: { width: 1280, height: 800, scale: 1, fontScale: 1 } });

type Listener = (e: unknown) => void;
const flat = (style: unknown): Record<string, unknown> => (Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : style && typeof style === "object" ? (style as Record<string, unknown>) : {});

test("resolveMenuPoint keeps a real point and replaces a missing one with the control that was pressed", () => {
  resetAnchor();
  assert.deepEqual(resolveMenuPoint(120, 80), { x: 120, y: 80 });
  assert.deepEqual(resolveMenuPoint(-1, -1), { x: 6, y: 6 }, "nothing remembered yet: the corner margin, as before");
  noteAnchor({ getBoundingClientRect: () => ({ left: 240, bottom: 96 }) });
  assert.deepEqual(resolveMenuPoint(-1, -1), { x: 240, y: 100 }, "under the pressed control, a few pixels below");
  assert.deepEqual(resolveMenuPoint(0, 0), { x: 0, y: 0 }, "a real pointer position is never replaced");
  noteAnchor({ closest: () => ({ getBoundingClientRect: () => ({ left: 10, bottom: 20 }) }), getBoundingClientRect: () => ({ left: 0, bottom: 0 }) });
  assert.deepEqual(resolveMenuPoint(NaN, 5), { x: 10, y: 24 }, "the nearest button wins over the glyph inside it");
});

test("pressing the plus beside Personal opens New blank automation under the plus", async () => {
  resetAnchor();
  const listeners: Record<string, Listener[]> = {};
  const doc = (globalThis as unknown as { document: { addEventListener: (t: string, f: Listener) => void } }).document;
  doc.addEventListener = (t, f) => { (listeners[t] ??= []).push(f); };
  const s = createSampleAutomations(northwind);
  const root = await mount(createRoot, <AutomationsDataProvider value={s.data}><AutomationsSidebar shared={s.shared} reasons={s.space.reasons} /></AutomationsDataProvider>);
  await flush();
  const plus = find(root, "add-personal");
  assert.ok(plus, "the plus beside Personal is drawn");
  assert.ok((listeners["pointerdown"] ?? []).length > 0, "the Menu listens for presses once a menu surface is on screen");
  // the browser fires pointerdown on the button before the click
  for (const f of listeners["pointerdown"] ?? []) f({ target: { closest: () => ({ getBoundingClientRect: () => ({ left: 233, bottom: 140 }) }) } });
  await press(plus);
  await flush();
  const menu = find(root, "menu");
  assert.ok(menu, "the menu opened");
  const style = flat(menu!.props.style);
  assert.equal(style["left"], "233px");
  assert.equal(style["top"], "144px");
  assert.notDeepEqual([style["left"], style["top"]], ["0px", "0px"]);
  assert.notDeepEqual([style["left"], style["top"]], ["6px", "6px"]);
  assert.ok(find(root, "menu-item-New blank automation"), "the menu holds the blank choice");
  assert.ok(find(root, "menu-item-New group"), "and New group");
});
