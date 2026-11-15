// The design's keys (prototype, G74): Cmd-B and Shift-Cmd-\ hide or show the sidebar, Cmd-\ the pane beside the chat.
import test from "node:test";
import assert from "node:assert/strict";
import { matchShortcut } from "./map.ts";
import { shellKey } from "../spaces/keys.ts";

test("Cmd-B is the sidebar and Cmd-\\ is the pane, in the shell's keys and in the Settings map", () => {
  assert.deepEqual(shellKey({ key: "b", metaKey: true }), { type: "sidebar" });
  assert.deepEqual(shellKey({ key: "b", ctrlKey: true }), { type: "sidebar" });
  assert.deepEqual(shellKey({ key: "\\", metaKey: true }), { type: "pane" });
  assert.deepEqual(shellKey({ key: "|", metaKey: true, shiftKey: true }), { type: "sidebar" });
  assert.deepEqual(matchShortcut({ key: "b", metaKey: true }, "mac"), { id: "sidebar.hide" });
  assert.deepEqual(matchShortcut({ key: "\\", code: "Backslash", metaKey: true }, "mac"), { id: "pane.toggle" });
  assert.deepEqual(matchShortcut({ key: "|", code: "Backslash", metaKey: true, shiftKey: true }, "mac"), {
    id: "sidebar.hide",
  });
  assert.equal(shellKey({ key: "b" }), null, "a plain b is a letter");
});
