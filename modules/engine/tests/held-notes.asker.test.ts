// The note an answered held call or a reviewed file leaves is for the turn of the person it answers; a second person writing to the same agent in the same chat does not get it (lane f-asker, 13 Nov).
import test from "node:test";
import assert from "node:assert/strict";
import { queueHeldNote, takeHeldNotes } from "../held-notes.ts";

test("a held note goes to the turn of the person it answers, and a note for nobody goes to any turn", () => {
  queueHeldNote("thr_g", "agt_x", "what the held call gave back", "usr_olivia");
  queueHeldNote("thr_g", "agt_x", "the routine is due now");
  assert.deepEqual(
    takeHeldNotes("thr_g", "agt_x", "usr_omar"),
    ["the routine is due now"],
    "Omar gets the routine's note and nothing of Olivia's",
  );
  assert.deepEqual(takeHeldNotes("thr_g", "agt_x", "usr_olivia"), ["what the held call gave back"]);
  assert.deepEqual(takeHeldNotes("thr_g", "agt_x", "usr_olivia"), []);
  queueHeldNote("thr_g", "agt_x", "kept for the server wake", "usr_olivia");
  assert.deepEqual(
    takeHeldNotes("thr_g", "agt_x"),
    ["kept for the server wake"],
    "no asker named: the server's wake takes every note",
  );
});
