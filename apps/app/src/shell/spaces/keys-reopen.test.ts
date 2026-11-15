// Shift-Cmd-T brings the closed tab back (TABS-2026-11-15.md D6); Cmd-T and Cmd-W keep their keys.
import test from "node:test";
import assert from "node:assert/strict";
import { shellKey } from "./keys.ts";

test("Shift-Cmd-T (Shift-Ctrl-T off the Mac) is Reopen closed tab; Cmd-T is a new tab", () => {
  assert.deepEqual(shellKey({ key: "T", metaKey: true, shiftKey: true }), { type: "reopen-tab" });
  assert.deepEqual(shellKey({ key: "t", ctrlKey: true, shiftKey: true }), { type: "reopen-tab" });
  assert.deepEqual(shellKey({ key: "t", metaKey: true }), { type: "new-tab" });
  assert.equal(shellKey({ key: "t" }), null);
});
