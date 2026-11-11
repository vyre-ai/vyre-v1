// One Escape closes one layer (ui/Overlay/escape.ts): the topmost layer only, never the date picker and the dialog under it together; a key an inner field already handled is left alone.
import test from "node:test";
import assert from "node:assert/strict";
import { escapeLayers, pushEscapeLayer } from "./escape.ts";

type Fn = (e: { key?: string; defaultPrevented?: boolean }) => void;
function fakeDocument(): { press(key: string, defaultPrevented?: boolean): void; count(): number; restore(): void } {
  const g = globalThis as { document?: unknown };
  const had = g.document;
  const on = new Set<Fn>();
  g.document = { addEventListener: (_t: string, f: Fn) => { on.add(f); }, removeEventListener: (_t: string, f: Fn) => { on.delete(f); } };
  return { press: (key, defaultPrevented = false) => { for (const f of [...on]) f({ key, defaultPrevented }); }, count: () => on.size, restore: () => { if (had === undefined) delete g.document; else g.document = had; } };
}

test("Escape goes to the newest layer only; closing it hands the next Escape to the one under it", () => {
  const d = fakeDocument();
  try {
    const ran: string[] = [];
    const offDialog = pushEscapeLayer(() => ran.push("dialog"));
    const offPicker = pushEscapeLayer(() => ran.push("picker"));
    d.press("Escape");
    assert.deepEqual(ran, ["picker"], "the picker closes and the dialog stays");
    offPicker();
    d.press("Escape");
    assert.deepEqual(ran, ["picker", "dialog"]);
    offDialog();
    assert.equal(escapeLayers(), 0);
    assert.equal(d.count(), 0, "no layers, no listener left on the document");
  } finally { d.restore(); }
});

test("other keys do nothing, and a key an inner field handled is not taken again", () => {
  const d = fakeDocument();
  try {
    const ran: string[] = [];
    const off = pushEscapeLayer(() => ran.push("layer"));
    d.press("Enter");
    d.press("Escape", true);
    assert.deepEqual(ran, []);
    d.press("Escape");
    assert.deepEqual(ran, ["layer"]);
    off();
  } finally { d.restore(); }
});

test("one listener serves any number of layers", () => {
  const d = fakeDocument();
  try {
    const offs = [pushEscapeLayer(() => undefined), pushEscapeLayer(() => undefined), pushEscapeLayer(() => undefined)];
    assert.equal(d.count(), 1);
    for (const o of offs) o();
    assert.equal(d.count(), 0);
  } finally { d.restore(); }
});
