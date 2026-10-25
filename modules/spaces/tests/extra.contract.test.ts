// The generated contract for the eight spaces capabilities without a packet, run against the REAL handlers: the same example inputs and schema samples the stub
// answered, checked against the registry's schemas (P-L7_07b).
// @reads /generated/registry.json

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sample, validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";
import { world } from "../handlers/extra/memdb.ts";
import type { World } from "../handlers/extra/memdb.ts";
import { configureSpaceAdmin, extraHandlers } from "../handlers/extra/index.ts";
import type { ExtraCtx } from "../handlers/extra/index.ts";

interface RegCap {
  name: string; module: string; v: number; input: JsonSchema; output: JsonSchema; emits: string[];
  examples: { name: string; input: unknown; output: unknown }[];
}
interface RegEvent { name: string; module: string; payload: JsonSchema }
interface Registry { $defs: Record<string, JsonSchema>; capabilities: RegCap[]; events: RegEvent[] }

const registry = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as Registry;
const defs = registry.$defs;
const mine = Object.keys(extraHandlers);
const caps = registry.capabilities.filter((c) => c.module === "spaces" && mine.includes(c.name));
const eventSchemas = new Map(registry.events.map((e) => [e.name, e.payload]));

type Fn = (ctx: ExtraCtx, input: never) => Promise<unknown>;
const run = (name: string, ctx: ExtraCtx, input: unknown): Promise<unknown> => {
  const fn = (extraHandlers as unknown as Record<string, Fn>)[name];
  assert.ok(fn, `a handler for ${name}`);
  return fn(ctx, input as never);
};

/** The Space is named "example", which is what the delete example types; the caller is the owner, except for leave, where the owner may not. */
function populated(cap: string): World {
  const w = world({ name: "example" });
  configureSpaceAdmin(w.drivers);
  if (cap === "spaces.leave") w.asPerson("usr_ines");
  return w;
}

afterEach(() => configureSpaceAdmin(null));

test("the registry declares exactly the eight capabilities this packet handles", () => {
  assert.equal(caps.length, 8);
  assert.deepEqual(caps.map((c) => c.name).sort(), [...mine].sort());
});

for (const cap of caps) {
  const name = `${cap.name}@${cap.v}`;

  test(`${name}: real handler answers the example input with a valid output`, async () => {
    assert.ok(cap.examples.length >= 1);
    for (const ex of cap.examples) {
      assert.deepEqual(validate(cap.input, ex.input, "", defs), [], `example ${ex.name} input is valid`);
      const w = populated(cap.name);
      const out = await run(cap.name, w.ctx, ex.input);
      assert.deepEqual(validate(cap.output, out, "", defs), [], `example ${ex.name} output`);
      for (const e of w.events) {
        assert.ok(cap.emits.includes(e.name), `${e.name} is declared in emits of ${cap.name}`);
        const schema = eventSchemas.get(e.name);
        assert.ok(schema, `${e.name} has a schema`);
        assert.deepEqual(validate(schema, e.payload, "", defs), [], `${e.name} payload`);
      }
    }
  });

  test(`${name}: real handler answers the schema sample with a valid output`, async () => {
    const input = sample(cap.input, 0, defs);
    assert.deepEqual(validate(cap.input, input, "", defs), []);
    const w = populated(cap.name);
    const out = await run(cap.name, w.ctx, input);
    assert.deepEqual(validate(cap.output, out, "", defs), []);
  });

  test(`${name}: every declared event is emitted by the handler that declares it`, async () => {
    const w = populated(cap.name);
    // the example asks for the relay the Space already uses, which changes nothing and so announces nothing; the event needs a real move
    const input = cap.name === "spaces.switch_address" ? { mode: "own_domain", host: "team.example.com" } : cap.examples[0]!.input;
    await run(cap.name, w.ctx, input);
    assert.deepEqual([...new Set(w.events.map((e) => e.name))].sort(), [...cap.emits].sort());
  });
}
