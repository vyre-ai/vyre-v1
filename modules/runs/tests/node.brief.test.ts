// Typed briefs and results (r42-runtime): a node started with what it must hand back is not done until what it hands back fits; the worker is told in plain words what does not; a node with no shape accepts what it always did.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, hold, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, engine } from "../fixtures/seed.ts";
import { problems } from "../brief.ts";
import type { Schema } from "../brief.ts";

const SCHEMA: Schema = {
  type: "object",
  required: ["supplier", "price", "inStock"],
  properties: {
    supplier: { type: "string", maxLength: 40 },
    price: { type: "number" },
    inStock: { type: "boolean" },
    tier: { type: "string", enum: ["gold", "silver"] },
    notes: { type: "array", items: { type: "string" } },
  },
};
const start = async (h: Harness, brief?: unknown) =>
  (
    await h.call(
      "runs.node.start",
      { kind: "helper", owner: alice.id, running: true, ...(brief === undefined ? {} : { brief }) },
      engine,
    )
  ).node as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const done = (h: Harness, id: string, result: unknown) =>
  h.call("runs.node.move", { ...hold(h, id), runId: id, to: "succeeded", why: "done", result }, engine);

test("a result that fits is accepted and kept; one that does not is refused with every reason in plain words, and the node stays what it was", async () => {
  const h = harness();
  const n = await start(h, {
    goal: "Price the Calder bid",
    expects: { schema: SCHEMA, doneWhen: "the sheet has the price" },
  });
  const e = await done(h, n.id, { supplier: "Calder", price: "3,400", tier: "bronze", notes: ["ok", 4] }).catch(
    (x) => x,
  );
  assert.equal(reasonOf(e), "result_invalid");
  const said = (e as { error: { message: string } }).error.message;
  assert.match(said, /"price" should be a number, not a string\./);
  assert.match(said, /the result has no "inStock"\./);
  assert.match(said, /"tier" should be one of "gold", "silver"\./);
  assert.match(said, /item 2 should be a string, not a number\./);
  assert.equal(
    (h.sqlite.prepare("SELECT status FROM runs_node WHERE run_id = ?").get(n.id) as { status: string }).status,
    "running",
  );
  const ok = await done(h, n.id, { supplier: "Calder", price: 3400, inStock: true, tier: "gold" });
  assert.equal(ok.changed, true);
  assert.deepEqual((await h.call("runs.node.get", { runId: n.id }, { ...alice, depth: 0 })).node.result, {
    supplier: "Calder",
    price: 3400,
    inStock: true,
    tier: "gold",
  });
});

test("a node with no shape accepts any result, and so does one that is done without a result", async () => {
  const h = harness();
  const a = await start(h, { goal: "Look something up" });
  assert.equal((await done(h, a.id, "just words")).changed, true);
  const b = await start(h, { goal: "x", expects: { schema: SCHEMA } });
  const nothing = await h.call(
    "runs.node.move",
    { ...hold(h, b.id), runId: b.id, to: "succeeded", why: "done", summary: "Done without a result" },
    engine,
  );
  assert.equal(nothing.changed, true, "a result is checked when one is given");
});

test("a brief that is not a brief, or a shape that is not a shape, or one too large, is refused at the start", async () => {
  const h = harness();
  const bad = async (brief: unknown) =>
    reasonOf(await h.call("runs.node.start", { kind: "helper", owner: alice.id, brief }, engine).catch((x) => x));
  assert.equal(await bad([1, 2]), "bad_brief");
  assert.equal(await bad({ expects: [] }), "bad_brief");
  assert.equal(await bad({ expects: { schema: "object" } }), "bad_schema");
  assert.equal(
    await bad({ expects: { schema: { type: "object", properties: { x: { enum: ["y".repeat(9000)] } } } } }),
    "bad_schema",
  );
});

test("the checker reads a small shape and nothing more: types, required keys, enum, items, length; a number is an integer only when it is one", () => {
  assert.deepEqual(problems({ type: "integer" }, 3), []);
  assert.match(problems({ type: "integer" }, 3.5)[0]!, /should be an integer/);
  assert.deepEqual(problems({ type: "string", maxLength: 3 }, "abcd"), ["the result is 4 characters; at most 3."]);
  assert.match(problems({ type: "object", required: ["a"] }, {})[0]!, /has no "a"/);
  assert.match(problems({ type: "object", required: ["a"] }, { a: null })[0]!, /has no "a"/);
  assert.deepEqual(problems({ type: "array", items: { type: "number" } }, [1, 2, 3]), []);
  assert.equal(
    problems({ type: "object", properties: { a: { type: "string" } } }, { a: 1, b: 2 }).length,
    1,
    "a key it does not name is its own business",
  );
  assert.ok(
    problems(
      { type: "array", items: { type: "string" } },
      Array.from({ length: 80 }, () => 1),
    ).length <= 6,
    "never a wall of problems",
  );
});
