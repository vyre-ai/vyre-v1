// A file or a record named in a chat opens in the right pane (TABS-2026-11-15.md D3, D4): which kinds, and how a second thing replaces the first with a way back.
import test from "node:test";
import assert from "node:assert/strict";
import { nextTrail, thingOf } from "./thing-model.ts";

test("a file, a document and a record show in the pane; any other kind opens as a tab", () => {
  assert.deepEqual(thingOf("file", "fil_1"), { type: "file", id: "fil_1" });
  assert.deepEqual(thingOf("doc", "fil_2"), { type: "file", id: "fil_2" });
  assert.deepEqual(thingOf("document", "fil_3"), { type: "file", id: "fil_3" });
  assert.deepEqual(thingOf("record", "rec_1"), { type: "record", id: "rec_1" });
  assert.deepEqual(thingOf("contact", "rec_2"), { type: "record", id: "rec_2" });
  for (const k of ["folder", "thread", "channel", "automation", "run", "artifact", "project", "item"])
    assert.equal(thingOf(k, "x_1"), null, `${k} is not shown in the pane`);
});

test("a second thing replaces the first and the first is kept for Back; the same thing twice changes nothing", () => {
  const a = { type: "file", id: "fil_1" } as const;
  const b = { type: "record", id: "rec_1" } as const;
  let trail = nextTrail([], a);
  assert.deepEqual(trail, [a]);
  assert.equal(nextTrail(trail, a), trail, "the same thing again is the same pane");
  trail = nextTrail(trail, b);
  assert.deepEqual(trail, [a, b]);
  assert.deepEqual(trail.slice(0, -1), [a], "Back shows the first again");
});
