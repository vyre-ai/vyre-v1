// The Kanban's numbers: a column header's count against its limit, value total, late cards; a card's days and its required-field ring; the rows a long lane draws.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DAY_MS,
  HOUR_MS,
  columnStats,
  daysIn,
  daysLate,
  fieldsNeeded,
  limitWords,
  requiredProgress,
  swimKeys,
  windowOf,
} from "./stats.ts";
import type { FieldDef, RecordRow } from "../views-a/model.ts";

const NOW = Date.UTC(2026, 10, 19, 10, 0, 0);
const row = (id: string, fields: Record<string, unknown>): RecordRow =>
  ({ id, type: "clients", version: 1, label: 0, fields, createdAt: 0, updatedAt: 0, holds: 0 }) as RecordRow;
const VALUE = { key: "value", type: "number", title: "Value" } as FieldDef;

test("days in a stage and days late", () => {
  assert.equal(daysIn(NOW - 3 * DAY_MS - HOUR_MS, NOW), 3);
  assert.equal(daysIn(NOW + DAY_MS, NOW), 0);
  assert.equal(daysLate(NOW - 6 * DAY_MS, NOW, 5 * 24), 1);
  assert.equal(daysLate(NOW - 4 * DAY_MS, NOW, 5 * 24), 0);
  assert.equal(daysLate(NOW - 99 * DAY_MS, NOW, undefined), 0);
});

test("a limit in words", () => {
  assert.equal(limitWords(120), "5 d");
  assert.equal(limitWords(12), "12 h");
  assert.equal(limitWords(47), "47 h");
});

test("a column header: count against its WIP limit, late cards, a value total that says when it is partial", () => {
  const rows = [row("a", { value: 1000 }), row("b", { value: 500 }), row("c", {})];
  const at: Record<string, number> = { a: NOW - 6 * DAY_MS, b: NOW - DAY_MS, c: NOW - 9 * DAY_MS };
  const s = columnStats(
    { key: "prop", title: "Proposal", limitHours: 120, wip: 2 },
    rows,
    3,
    VALUE,
    (r) => at[r.id],
    NOW,
  );
  assert.equal(s.countText, "3 of 2");
  assert.equal(s.overWip, true);
  assert.equal(s.late, 2);
  assert.equal(s.total, 1500);
  assert.equal(s.partial, false);
  const big = columnStats({ key: "lead", title: "Lead" }, rows, 5000, VALUE, () => undefined, NOW, 7);
  assert.equal(big.countText, "5000");
  assert.equal(big.overWip, false);
  assert.equal(big.late, 7, "the server's late count wins for a lane that is not all loaded");
  assert.equal(big.partial, true);
  assert.equal(columnStats({ key: "x", title: "X" }, [], 0, VALUE, () => undefined, NOW).total, null);
});

test("the required-fields ring and what a move needs", () => {
  assert.equal(requiredProgress(row("a", {}), []), null);
  assert.deepEqual(requiredProgress(row("a", { amount: 5 }), ["amount", "owner"]), {
    filled: 1,
    of: 2,
    missing: ["owner"],
  });
  const n = fieldsNeeded(
    row("a", { amount: "" }),
    { key: "qual", title: "Q", needToLeave: ["owner"] },
    { key: "prop", title: "P", needToEnter: ["amount"] },
  );
  assert.deepEqual(n, [
    { key: "owner", stage: "qual", when: "leave" },
    { key: "amount", stage: "prop", when: "enter" },
  ]);
});

test("swimlane keys in first-seen order, the empty value last", () => {
  const f = { key: "owner", type: "person", title: "Owner" } as FieldDef;
  assert.deepEqual(
    swimKeys([row("a", { owner: "u2" }), row("b", {}), row("c", { owner: "u1" }), row("d", { owner: "u2" })], f),
    ["u2", "u1", ""],
  );
});

test("a long lane draws only the rows near the screen and keeps the scroll length", () => {
  const w = windowOf(10_000, 100, 5_000, 800);
  assert.equal(w.from, 44);
  assert.equal(w.to, 64);
  assert.equal(w.before, 4_400);
  assert.equal(w.after, (10_000 - 64) * 100);
  assert.deepEqual(windowOf(3, 100, 0, 800), { from: 0, to: 3, before: 0, after: 0 });
});

test("a money value sums by its amount", async () => {
  const { numberOf } = await import("./stats.ts");
  assert.equal(numberOf({ amount: 1200, currency: "USD" }), 1200);
  assert.equal(numberOf(5), 5);
  assert.equal(numberOf("5"), null);
  assert.equal(numberOf(null), null);
});
