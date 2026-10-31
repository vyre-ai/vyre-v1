// The step palette hands the step panel each input schema whole: a client that has no `$defs` table must be able to draw a field for every property, so no `$ref` is left in what steps.list returns.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { alice } from "../fixtures/seed.ts";

const refsIn = (v: unknown, path: string, out: string[]): void => {
  if (Array.isArray(v)) { v.forEach((x, n) => refsIn(x, `${path}[${n}]`, out)); return; }
  if (!v || typeof v !== "object") return;
  for (const [k, x] of Object.entries(v)) {
    if (k === "$ref") out.push(`${path}.$ref`);
    else refsIn(x, `${path}.${k}`, out);
  }
};

test("steps.list returns every input schema with its references put in place", async () => {
  const h = harness();
  const steps = (await h.call("automations.steps.list", {}, alice)).steps as { key: string; input?: { properties?: Record<string, unknown> } }[];
  assert.ok(steps.length >= 60, "the whole palette");
  const left: string[] = [];
  for (const s of steps) refsIn(s.input, s.key, left);
  assert.deepEqual(left, [], "no $ref is left for the client to chase");
  // the steps whose whole input used to be one reference now list their properties
  for (const key of ["files.copy", "files.move", "files.share", "github.pull_request.get", "google.gmail.list_messages", "google.sheets.get_values", "records.relate"]) {
    const s = steps.find((x) => x.key === key);
    assert.ok(s, key);
    assert.ok(Object.keys(s!.input?.properties ?? {}).length > 0, `${key} lists its properties`);
  }
});
