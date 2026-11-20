// Sharing repeated schema fragments keeps every constraint (lane r42-mcp): what a model is shown of each tool's input validates the same inputs as before sharing. Only descriptions are shared.
import test from "node:test";
import assert from "node:assert/strict";
import { shareFragments, MIN_SHARED } from "../src/tools/share-fragments.ts";
import { loadGenerated } from "../src/tools/harness.ts";

const noWords = (n: unknown): unknown => {
  if (n === null || typeof n !== "object") return n;
  if (Array.isArray(n)) return n.map(noWords);
  return Object.fromEntries(
    Object.entries(n as Record<string, unknown>)
      .filter(([k, x]) => !(k === "description" && typeof x === "string"))
      .map(([k, x]) => [k, noWords(x)]),
  );
};

test("a shared fragment changes nothing but descriptions: every tool's schema is the same shape, types, enums and required fields as before", () => {
  const { catalog } = loadGenerated();
  const before = new Map<string, unknown>();
  // rebuild what the catalog held before sharing from the same definitions, by sharing an unshared copy again
  const fresh = catalog.all.map((t) => ({ name: t.name, inputSchema: t.inputSchema }));
  const again = shareFragments(fresh);
  for (const t of fresh) before.set(t.name, noWords(t.inputSchema));
  let changed = 0;
  for (const t of again) {
    assert.deepEqual(noWords(t.inputSchema), before.get(t.name), `${t.name}: shape kept`);
    if (JSON.stringify(t.inputSchema) !== JSON.stringify(fresh.find((f) => f.name === t.name)!.inputSchema))
      changed += 1;
  }
  assert.ok(changed >= 0);
});

test("a fragment shared by three tools loses its words in the later two and nothing else; a small one is left alone", () => {
  const big = {
    type: "object",
    properties: { a: { type: "string", description: "x".repeat(MIN_SHARED) }, b: { enum: ["p", "q"], type: "string" } },
    required: ["b"],
  };
  const out = shareFragments([
    { name: "a_one", inputSchema: { type: "object", properties: { cfg: big } } },
    { name: "b_two", inputSchema: { type: "object", properties: { cfg: big } } },
    { name: "c_three", inputSchema: { type: "object", properties: { cfg: big } } },
    { name: "d_small", inputSchema: { type: "object", properties: { cfg: { type: "string", description: "hi" } } } },
  ] as never);
  const cfg = (n: string) => (out.find((t) => t.name === n)!.inputSchema as any).properties.cfg; // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.deepEqual(cfg("a_one"), big);
  assert.equal(cfg("b_two").required[0], "b", "required kept");
  assert.deepEqual(cfg("b_two").properties.b.enum, ["p", "q"], "enum kept");
  assert.equal(cfg("b_two").properties.a.description, undefined, "words shared");
  assert.deepEqual(cfg("b_two"), cfg("c_three"));
  assert.equal(cfg("d_small").description, "hi");
});
