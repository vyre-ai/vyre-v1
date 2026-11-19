import test from "node:test";
import assert from "node:assert/strict";
import { MAX_STARTS_PER_TICK, jitterMs } from "../handlers/cadence.ts";

test("a type's place inside its interval is its own and the same every time; types do not share one", () => {
  const ids = Array.from({ length: 12 }, (_, i) => `syt_${i}abc`);
  const places = ids.map((id) => jitterMs(id, 900_000));
  assert.deepEqual(
    places,
    ids.map((id) => jitterMs(id, 900_000)),
    "stable",
  );
  assert.ok(new Set(places).size >= 10, "spread, not stacked");
  assert.ok(
    places.every((p) => p >= 0 && p < 60_000),
    "a minute at most",
  );
  assert.ok(jitterMs("syt_x", 20_000) < 5_000, "a short interval gets a short spread");
});

test("the driver starts a few passes a tick, never every due type at once", () => {
  assert.ok(MAX_STARTS_PER_TICK >= 1 && MAX_STARTS_PER_TICK <= 3);
});
