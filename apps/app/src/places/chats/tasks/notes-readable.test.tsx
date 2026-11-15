// @tsx
// The task view's working notes: no app bookkeeping and no id as a line a person reads (owner's walk, 15 Nov: "chat.block: blk_..." and "chat.plan: pln_..." on a task made from a plan).
import test from "node:test";
import assert from "node:assert/strict";
import { readableNotes } from "./TaskDetail.tsx";
import { rawIdsIn } from "../../../../../../lib/id-shapes.ts";

test("a task made from a plan shows no chat.block or chat.plan line, and a note that is only an id never shows", () => {
  const notes = {
    "chat.block": "blk_01a1e0868ea3405fac5c918b4f982b5f",
    "chat.plan": "pln_01a1e0868ea3405fac5c918b4f982b5f",
    "owner.ref": "usr_01a1e0868ea3405fac5c918b4f982b5f",
    brief: "Read the notes",
    ticket: "Call the supplier on Monday",
  };
  const shown = readableNotes(notes);
  assert.deepEqual(shown, [["ticket", "Call the supplier on Monday"]]);
  assert.deepEqual(rawIdsIn(shown.map(([k, v]) => `${k}: ${v}`).join("\n")), []);
});
