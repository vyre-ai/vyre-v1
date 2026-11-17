// The log's read takes a list of exact types: what a consumer asks for, so it never reads the events it does not handle.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { LogStore } from "../src/log/store.ts";

test("read({ types }) returns only events of those types, in order, and nothing for an empty list", () => {
  const store = new LogStore({ db: new DatabaseSync(":memory:"), space: "sp_1" });
  store.appendBatch(
    ["a.one", "b.two", "a.one", "c.three", "b.two"].map(
      (type) =>
        ({
          type,
          sv: 1,
          trace_id: "a".repeat(32),
          actor: "usr_dana",
          vis: "space",
          entity: "rec",
          entity_id: "r1",
          fields: ["name"],
          payload: {},
        }) as never,
    ),
  );
  assert.deepEqual(
    store.read({ types: ["a.one"] }).map((e) => e.seq),
    [1, 3],
  );
  assert.deepEqual(
    store.read({ types: ["c.three", "b.two"] }).map((e) => e.type),
    ["b.two", "c.three", "b.two"],
  );
  assert.deepEqual(
    store.read({ types: ["b.two"], after: 2 }).map((e) => e.seq),
    [5],
  );
  assert.deepEqual(store.read({ types: [] }), []);
  assert.equal(store.read({}).length, 5, "no types means every type, as before");
});
