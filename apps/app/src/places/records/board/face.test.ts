// A card's face: which field is the owner and the amount, how its time reads, the need line, the totals.
import test from "node:test";
import assert from "node:assert/strict";
import { ageOf, needLine, splitFace, totalText } from "./face.ts";
import { DAY_MS } from "./stats.ts";
import type { FieldDef } from "../views-a/model.ts";

const f = (key: string, type: string): FieldDef => ({ key, type, title: key }) as FieldDef;
const NOW = Date.UTC(2026, 10, 19, 10);

test("a face is split into owner, amount and the rest", () => {
  const s = splitFace([f("note", "text"), f("rep", "person"), f("worth", "money"), f("qty", "number")]);
  assert.equal(s.owner?.key, "rep");
  assert.equal(s.amount?.key, "worth");
  assert.deepEqual(
    s.rest.map((x) => x.key),
    ["note", "qty"],
  );
  assert.equal(splitFace([f("qty", "number")]).amount?.key, "qty");
  assert.equal(splitFace([]).owner, undefined);
});

test("time in the stage: the day, or days late past the limit, or nothing known", () => {
  assert.deepEqual(ageOf(NOW - 2 * DAY_MS, NOW, 120), { text: "Day 2", late: false });
  assert.deepEqual(ageOf(NOW - 7 * DAY_MS, NOW, 120), { text: "2 d late", late: true });
  assert.equal(ageOf(undefined, NOW, 120), null);
});

test("the line for a missing field before the next stage", () => {
  assert.equal(needLine(["Amount"], "Proposal"), "Needs amount before Proposal");
  assert.equal(needLine(["Amount", "Owner"], "Proposal"), "Needs 2 fields before Proposal");
  assert.equal(needLine([], "Proposal"), null);
  assert.equal(needLine(["Amount"], undefined), null);
});

test("a total in few characters", () => {
  assert.equal(totalText(850), "$850");
  assert.equal(totalText(74_000), "$74k");
  assert.equal(totalText(1_240_000), "$1.2M");
});
