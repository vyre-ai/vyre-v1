// Escape and ui/Menu (rc.24 walk, 11 Nov 2026): a menu opened from the keyboard has nothing lit and focus still on the control that opened it, so Escape must close it from there; and the Escape that
// closes a menu inside a sheet closes the menu only.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot } from "test-renderer";
import { installDom, find, flush, mount } from "../testing/dom.ts";
import { useMenu } from "./index.tsx";
import { pushEscapeLayer } from "../Overlay/escape.ts";

type Api = ReturnType<typeof useMenu>;
let api: Api | null = null;
function Host(): ReactElement | null {
  const m = useMenu();
  api = m;
  return m.element;
}

type Ev = { key: string; defaultPrevented?: boolean; preventDefault(): void; stopPropagation(): void };
type Fn = (e: Ev) => void;
/** A document that runs capture listeners, then bubble ones, and stops when a listener stops the event: the order a browser uses for a key pressed with focus outside the menu. */
function browserDocument(): { press(key: string): void; restore(): void } {
  const g = globalThis as { document?: Record<string, unknown> };
  const doc = g.document!;
  const had = { add: Object.getOwnPropertyDescriptor(doc, "addEventListener"), remove: Object.getOwnPropertyDescriptor(doc, "removeEventListener") };
  const capture: Fn[] = []; const bubble: Fn[] = [];
  const list = (c?: boolean): Fn[] => (c ? capture : bubble);
  doc["addEventListener"] = (_t: string, f: Fn, c?: boolean) => { list(c).push(f); };
  doc["removeEventListener"] = (_t: string, f: Fn, c?: boolean) => { const l = list(c); const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); };
  return {
    press(key) {
      let stopped = false;
      const e: Ev = { key, defaultPrevented: false, preventDefault() { e.defaultPrevented = true; }, stopPropagation() { stopped = true; } };
      for (const f of [...capture, ...bubble]) { if (stopped) break; f(e); }
    },
    restore() {
      if (had.add) Object.defineProperty(doc, "addEventListener", had.add); else delete doc["addEventListener"];
      if (had.remove) Object.defineProperty(doc, "removeEventListener", had.remove); else delete doc["removeEventListener"];
    },
  };
}

test("a menu opened by keyboard with nothing lit closes on Escape from the control that opened it", async () => {
  const restoreDom = installDom();
  const keys = browserDocument();
  try {
    const root = await mount(createRoot, <Host />);
    await act(async () => { api!.show([{ label: "Open", onSelect: () => undefined }, { label: "Delete", onSelect: () => undefined }], 10, 10, "other"); });
    await flush();
    assert.ok(find(root, "menu"), "the menu is open");
    await act(async () => { keys.press("Escape"); });
    await flush();
    assert.equal(find(root, "menu"), null, "Escape closed it though nothing inside it had focus");
  } finally { keys.restore(); restoreDom(); }
});

test("Escape on a menu inside a sheet closes the menu only; the next Escape closes the sheet", async () => {
  const restoreDom = installDom();
  const keys = browserDocument();
  try {
    const sheet: string[] = [];
    const offSheet = pushEscapeLayer(() => sheet.push("closed"));
    const root = await mount(createRoot, <Host />);
    await act(async () => { api!.show([{ label: "Open", onSelect: () => undefined }], 10, 10, "other"); });
    await flush();
    await act(async () => { keys.press("Escape"); });
    await flush();
    assert.equal(find(root, "menu"), null, "the menu is gone");
    assert.deepEqual(sheet, [], "the sheet under it stayed");
    await act(async () => { keys.press("Escape"); });
    assert.deepEqual(sheet, ["closed"], "with no menu open, Escape reaches the sheet");
    offSheet();
  } finally { keys.restore(); restoreDom(); }
});
