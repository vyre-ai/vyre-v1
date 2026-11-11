// The phone sheet is one Escape layer: Escape closes it, a press on its scrim or its Done closes it, and when a menu or a picker is drawn over it the first Escape closes that and the sheet stays.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { Text } from "react-native";
import { createRoot } from "test-renderer";
import { installDom, find, mount, press } from "../../../../../ui/src/testing/dom.ts";
import { escapeLayers, pushEscapeLayer } from "../../../../../ui/src/Overlay/escape.ts";
import { Sheet } from "./Sheet.tsx";

type Fn = (e: { key: string; defaultPrevented?: boolean }) => void;
function browserDocument(): { press(key: string): void; restore(): void } {
  const doc = (globalThis as { document: Record<string, unknown> }).document;
  const had = { add: Object.getOwnPropertyDescriptor(doc, "addEventListener"), remove: Object.getOwnPropertyDescriptor(doc, "removeEventListener") };
  const on = new Set<Fn>();
  doc["addEventListener"] = (_t: string, f: Fn) => { on.add(f); };
  doc["removeEventListener"] = (_t: string, f: Fn) => { on.delete(f); };
  return {
    press: (key) => { for (const f of [...on]) f({ key, defaultPrevented: false }); },
    restore() {
      if (had.add) Object.defineProperty(doc, "addEventListener", had.add); else delete doc["addEventListener"];
      if (had.remove) Object.defineProperty(doc, "removeEventListener", had.remove); else delete doc["removeEventListener"];
    },
  };
}

test("the phone sheet closes on Escape, on its scrim and on Done, and only the top layer takes an Escape", async () => {
  const restoreDom = installDom();
  const keys = browserDocument();
  try {
    const log: string[] = [];
    const root = await mount(createRoot, <Sheet open title="Record" onClose={() => log.push("closed")}><Text>Body</Text></Sheet>);
    assert.equal(escapeLayers() >= 1, true, "the sheet is a layer");
    await act(async () => { keys.press("Escape"); });
    assert.deepEqual(log, ["closed"], "Escape");
    await press(find(root, "sheet-scrim"));
    await press(find(root, "sheet-close"));
    assert.deepEqual(log, ["closed", "closed", "closed"], "the scrim and Done");
    const over: string[] = [];
    const off = pushEscapeLayer(() => over.push("picker"));
    await act(async () => { keys.press("Escape"); });
    assert.deepEqual(over, ["picker"], "a layer drawn over the sheet takes the Escape");
    assert.equal(log.length, 3, "and the sheet stays");
    off();
    await act(async () => { keys.press("Escape"); });
    assert.equal(log.length, 4, "with the picker gone, Escape reaches the sheet");
  } finally { keys.restore(); restoreDom(); }
});

test("a closed phone sheet is no layer", async () => {
  const restoreDom = installDom();
  const keys = browserDocument();
  try {
    const before = escapeLayers();
    await mount(createRoot, <Sheet open={false} title="Record" onClose={() => undefined}><Text>Body</Text></Sheet>);
    assert.equal(escapeLayers(), before);
  } finally { keys.restore(); restoreDom(); }
});
