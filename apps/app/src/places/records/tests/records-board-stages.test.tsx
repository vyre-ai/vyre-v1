// Records > board with chosen stages: a board can draw only the stages it names, in the order it names them. The pure part: which stage keys a saved view carries, the lanes they make, the order
// and choice edits, the count line and the query behind it.
import test from "node:test";
import assert from "node:assert/strict";
import { PLAIN } from "../table/model.ts";
import {
  chosenOf,
  laneFieldOf,
  lanesOf,
  moveStageKey,
  shownLine,
  shownSpec,
  stagesOfView,
  toggleStage,
} from "../views-a/model.ts";
import type { FieldDef, TypeDef } from "../views-a/model.ts";

const STAGES = ["new", "in_review", "approved", "paid", "closed"].map((key) => ({
  key,
  title: key === "in_review" ? "In review" : key[0]!.toUpperCase() + key.slice(1),
}));
const stage = { key: "stage", type: "status", title: "Stage", options: { stages: STAGES } } as unknown as FieldDef;
const def = {
  key: "request",
  title: "Request",
  plural: "Requests",
  titleField: "name",
  statusField: "stage",
  fields: [{ key: "name", type: "text", title: "Name" }, stage],
} as unknown as TypeDef;

test("a saved view's stages are its config.stages; nothing saved means every stage", () => {
  assert.deepEqual(stagesOfView(undefined), []);
  assert.deepEqual(stagesOfView({ config: {} } as never), []);
  assert.deepEqual(stagesOfView({ config: { stages: ["approved", "new", 4] } } as never), ["approved", "new"]);
  assert.deepEqual(stagesOfView({ config: { stages: "approved" } } as never), []);
});

test("without a choice every stage is a lane, then the lane of records with no stage; with a choice only those, in that order", () => {
  assert.deepEqual(
    lanesOf(stage).map((l) => l.key),
    ["new", "in_review", "approved", "paid", "closed", ""],
  );
  assert.deepEqual(
    lanesOf(stage, []).map((l) => l.key),
    ["new", "in_review", "approved", "paid", "closed", ""],
  );
  const some = lanesOf(stage, ["approved", "new"]);
  assert.deepEqual(
    some.map((l) => l.key),
    ["approved", "new"],
  );
  assert.equal(
    some.some((l) => l.none),
    false,
  );
  assert.equal(some[0]!.title, "Approved");
});

test("a chosen key the field does not have is left out; a choice with none of its stages draws every stage", () => {
  assert.deepEqual(chosenOf(stage, ["gone", "paid", "paid"]), ["paid"]);
  assert.deepEqual(
    lanesOf(stage, ["gone"]).map((l) => l.key),
    ["new", "in_review", "approved", "paid", "closed", ""],
  );
});

test("a board saved with config.group runs on that field", () => {
  assert.equal(laneFieldOf(def, { config: { group: "stage" } } as never)?.key, "stage");
});

test("choosing adds a stage at the end, again takes it out; moving swaps with its neighbour and stops at the ends", () => {
  assert.deepEqual(toggleStage(["new"], "paid"), ["new", "paid"]);
  assert.deepEqual(toggleStage(["new", "paid"], "new"), ["paid"]);
  assert.deepEqual(moveStageKey(["new", "paid", "closed"], "closed", -1), ["new", "closed", "paid"]);
  assert.deepEqual(moveStageKey(["new", "paid"], "new", -1), ["new", "paid"]);
  assert.deepEqual(moveStageKey(["new", "paid"], "paid", 1), ["new", "paid"]);
});

test("the count line says how many records the chosen stages show of the whole", () => {
  assert.equal(shownLine(1204, 9000, "Requests", 9), "1,204 of 9,000 requests are in these 9 stages");
  assert.equal(shownLine(3, 3, "Requests", 1), "3 of 3 requests are in this stage");
  assert.deepEqual(shownSpec("request", PLAIN, "name", stage, ["new", "paid"]), {
    type: "request",
    filter: { field: "stage", op: "in", value: ["new", "paid"] },
  });
  assert.deepEqual(shownSpec("request", PLAIN, "name", stage, null), { type: "request" });
  // the view's own filter narrows both counts, and a clause on the stage field itself is dropped as the lanes drop it
  const v = {
    ...PLAIN,
    clauses: [
      { field: "name", op: "contains", value: "Nor" },
      { field: "stage", op: "eq", value: "new" },
    ],
  };
  assert.deepEqual(shownSpec("request", v as never, "name", stage, ["paid"]), {
    type: "request",
    filter: {
      and: [
        { field: "name", op: "contains", value: "Nor" },
        { field: "stage", op: "in", value: ["paid"] },
      ],
    },
  });
});
