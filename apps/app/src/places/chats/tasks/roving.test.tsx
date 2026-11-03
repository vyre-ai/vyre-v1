// The keys on a focused card, through the hook the Board and the Timeline share: Tab lands on one card, arrows move, Enter opens, Space asks for status, Esc lets go.
import test from "node:test";
import assert from "node:assert/strict";
import type { ReactElement } from "react";
import { createRoot } from "test-renderer";
import { installDom, mount, flush } from "../../../../../../ui/src/testing/dom.ts";
import { gridStep } from "./keys.ts";
import { useRoving } from "./roving.ts";
import type { Roving } from "./roving.ts";

const COLS = [["a1", "a2"], ["b1"]];

function fakeKey(key: string, id: string, log: string[]): Parameters<Roving["onKeyDownCapture"]>[0] {
  const target = { getAttribute: (n: string) => (n === "data-tkcard" ? id : null), getBoundingClientRect: () => ({ left: 10, bottom: 50 }), blur: () => log.push("blur") };
  return { key, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, target, preventDefault: () => log.push("prevent"), stopPropagation: () => log.push("stop") };
}

test("one card takes Tab; arrows move the stop; Enter opens; Space asks for status where the card sits; Esc lets go", async () => {
  const restore = installDom();
  try {
    const log: string[] = [];
    let r!: Roving;
    function Host(): ReactElement | null {
      r = useRoving({ cols: COLS, step: (at, dir) => gridStep(COLS, at, dir), open: (id) => log.push(`open ${id}`), status: (id, at) => log.push(`status ${id} ${at.x},${at.y}`) });
      return null;
    }
    await mount(createRoot, <Host />);
    assert.equal(r.tab, "a1");
    r.onKeyDownCapture(fakeKey("ArrowDown", "a1", log));
    await flush();
    assert.equal(r.tab, "a2");
    assert.equal(r.active, "a2");
    r.onKeyDownCapture(fakeKey("ArrowRight", "a2", log));
    await flush();
    assert.equal(r.tab, "b1");
    r.onKeyDownCapture(fakeKey("ArrowRight", "b1", log));
    await flush();
    assert.equal(r.tab, "b1", "an edge stays put");
    r.onKeyDownCapture(fakeKey("Enter", "b1", log));
    r.onKeyDownCapture(fakeKey(" ", "b1", log));
    assert.ok(log.includes("open b1"));
    assert.ok(log.includes("status b1 10,54"));
    assert.ok(log.includes("stop"), "the card's own press does not also fire");
    log.length = 0;
    r.onKeyDownCapture(fakeKey("Escape", "b1", log));
    await flush();
    assert.ok(log.includes("blur"));
    assert.equal(r.active, null);
    assert.equal(r.tab, "a1");
    log.length = 0;
    r.onKeyDownCapture({ ...fakeKey("Enter", "x", log), target: { getAttribute: () => null } });
    assert.deepEqual(log, [], "a key inside a card's own button is that button's");
  } finally { restore(); }
});
