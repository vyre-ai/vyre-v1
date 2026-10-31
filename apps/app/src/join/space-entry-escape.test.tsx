// Escape goes back from the Space entry even with the cursor in the address field: the key listener is on the document in the capture phase (a text field stops the event at the React root).
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { flush, installDom, mount } from "../../../../ui/src/testing/dom.ts";
import { SpaceEntry } from "./SpaceEntry.tsx";

test("the Space entry listens for Escape in the capture phase and goes back when it comes", async () => {
  const restore = installDom();
  const doc = (globalThis as { document: { addEventListener: (t: string, f: (e: unknown) => void, c?: boolean) => void; removeEventListener: (t: string, f: (e: unknown) => void, c?: boolean) => void } }).document;
  const added: { type: string; fn: (e: unknown) => void; capture: boolean | undefined }[] = [];
  doc.addEventListener = (type, fn, capture) => { added.push({ type, fn, capture }); };
  doc.removeEventListener = () => undefined;
  let backs = 0;
  try {
    await mount(createRoot, <SpaceEntry startAt="join" onTarget={async () => undefined} onBack={() => { backs++; }} />);
    await flush();
    const keys = added.filter((a) => a.type === "keydown");
    assert.ok(keys.length > 0, "a key listener is on the document");
    assert.ok(keys.every((k) => k.capture === true), "in the capture phase, so a focused field cannot swallow Escape");
    keys[keys.length - 1]!.fn({ key: "Escape", preventDefault() {} });
    assert.equal(backs, 1, "Escape goes back to the doors");
  } finally { restore(); }
});
