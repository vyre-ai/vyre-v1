// Escape goes back from the Join and the Create steps even while a field has focus: the listener is on the document in the capture phase, so a field that stops the key on its way up cannot swallow it.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { installDom, mount } from "../onboarding/test-dom.ts";
import { SpaceEntry } from "./SpaceEntry.tsx";

// the halftone field animates on a canvas: no frames and no canvas in the node suite
const g = globalThis as { requestAnimationFrame?: (f: (t: number) => void) => number; cancelAnimationFrame?: (id: number) => void };
g.requestAnimationFrame ??= () => 0;
g.cancelAnimationFrame ??= () => undefined;
const box = { x: 0, y: 0, width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 };
Object.defineProperty(Object.prototype, "getBoundingClientRect", { value: () => box, configurable: true, enumerable: false, writable: true });
Object.defineProperty(Object.prototype, "getContext", { value: () => null, configurable: true, enumerable: false, writable: true });

type Listener = { type: string; fn: (e: { key: string; preventDefault(): void }) => void; capture: unknown };

test("the Escape listener is a capture-phase keydown on the document and goes back", async () => {
  installDom();
  const doc = (globalThis as { document: { addEventListener?: unknown; removeEventListener?: unknown } }).document;
  const added: Listener[] = [];
  const keep = { add: doc.addEventListener, remove: doc.removeEventListener };
  doc.addEventListener = (type: string, fn: Listener["fn"], capture?: unknown) => { added.push({ type, fn, capture }); };
  doc.removeEventListener = () => undefined;
  try {
    for (const startAt of ["join", "team"] as const) {
      added.length = 0;
      let backs = 0;
      await mount(createRoot, <SpaceEntry startAt={startAt} onTarget={() => undefined} onBack={() => { backs++; }} />);
      const esc = added.filter((l) => l.type === "keydown");
      assert.ok(esc.length >= 1, `${startAt}: a keydown listener`);
      assert.ok(esc.every((l) => l.capture === true), `${startAt}: in the capture phase`);
      esc[esc.length - 1]!.fn({ key: "Escape", preventDefault() {} });
      assert.equal(backs, 1, `${startAt}: Escape goes back to the doors`);
    }
  } finally { doc.addEventListener = keep.add; doc.removeEventListener = keep.remove; }
});
