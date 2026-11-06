import test from "node:test";
import assert from "node:assert/strict";
import { durationWords } from "./duration.ts";

const MIN = 60_000, H = 60 * MIN, D = 24 * H;

test("a duration reads now, minutes, hours and minutes, then days", () => {
  assert.equal(durationWords(0), "now");
  assert.equal(durationWords(59_999), "now");
  assert.equal(durationWords(MIN), "1 min");
  assert.equal(durationWords(12 * MIN), "12 min");
  assert.equal(durationWords(H), "1 h");
  assert.equal(durationWords(2 * H + 14 * MIN), "2 h 14 min");
  assert.equal(durationWords(D), "1 d");
  assert.equal(durationWords(3 * D + 5 * H), "3 d");
});

test("a run whose start is days old never prints a clock", () => {
  const started = Date.now() - 378 * D;
  assert.equal(durationWords(Date.now() - started), "378 d");
  assert.ok(!/:/.test(durationWords(Date.now() - started)));
});

test("nonsense reads now", () => {
  assert.equal(durationWords(-5), "now");
  assert.equal(durationWords(Number.NaN), "now");
  assert.equal(durationWords(Number.POSITIVE_INFINITY), "now");
});
