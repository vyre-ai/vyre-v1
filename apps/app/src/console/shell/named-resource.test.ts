import test from "node:test";
import assert from "node:assert/strict";
import { activityTitle, namedResource } from "./format.ts";

test("admin activity names what an act was on, and leaves out what it has no name for", () => {
  const name = (id: string): string => (id === "rec_1" ? "Acme Legal" : "Someone");
  assert.equal(activityTitle("Tom Reyes", "schema.apply", namedResource("spc_fresh", name)), "Tom Reyes applied a schema");
  assert.equal(activityTitle("Tom Reyes", "records.update", namedResource("rec_1", name)), "Tom Reyes changed the record Acme Legal");
});
