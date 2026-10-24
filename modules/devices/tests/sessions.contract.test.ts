// The generated contract for devices, run against the REAL handlers: the same example inputs the stub answered, outputs and events checked against the registry.
// This is the evidence for flipping devices to live (ARCH 12.4); the flip itself is P-L7_LIVE (ruling 25).
// @reads /generated/registry.json
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sample, validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";
import { harness, seedExampleWorld } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { handlers } from "../impl.ts";
import type { DevicesCtx } from "../handlers/index.ts";

interface RegCap { name: string; module: string; v: number; input: JsonSchema; output: JsonSchema; emits: string[]; examples: { name: string; input: unknown; output: unknown }[] }
interface RegEvent { name: string; module: string; payload: JsonSchema }
interface Registry { $defs: Record<string, JsonSchema>; capabilities: RegCap[]; events: RegEvent[] }
const registry = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as Registry;
const defs = registry.$defs;
const caps = registry.capabilities.filter((c) => c.module === "devices");
const eventSchemas = new Map(registry.events.filter((e) => e.module === "devices").map((e) => [e.name, e.payload]));

type Fn = (ctx: DevicesCtx, input: never) => Promise<unknown>;
const run = (name: string, ctx: DevicesCtx, input: unknown): Promise<unknown> => {
  const fn = (handlers as Record<string, Fn>)[name];
  assert.ok(fn, `a handler for ${name}`);
  return fn(ctx, input as never);
};

/** usr_a1b2c3 on a Mac (dev_a1b2c3) and a phone (dev_d4e5f6), asking from the phone. Purging needs a revoked device first. */
async function worldFor(cap: string): Promise<{ h: Harness; ctx: DevicesCtx }> {
  const h = harness();
  seedExampleWorld(h);
  const ctx = h.as("usr_a1b2c3", { admin: true, device: "dev_d4e5f6" });
  if (cap === "devices.purge_ack") {
    await run("devices.revoke", ctx, { deviceId: "dev_a1b2c3" });
    h.events.length = 0;
  }
  return { h, ctx };
}

test("a real handler exists for exactly the capabilities the registry declares for devices", () => {
  assert.equal(caps.length, 14);
  assert.deepEqual(Object.keys(handlers).sort(), caps.map((c) => c.name).sort());
});

for (const cap of caps) {
  const name = `${cap.name}@${cap.v}`;
  test(`${name}: real handler answers the example input with a valid output and declared events`, async () => {
    assert.ok(cap.examples.length >= 1);
    for (const ex of cap.examples) {
      assert.deepEqual(validate(cap.input, ex.input, "", defs), [], `example ${ex.name} input is valid`);
      const { h, ctx } = await worldFor(cap.name);
      const out = await run(cap.name, ctx, ex.input);
      assert.deepEqual(validate(cap.output, out, "", defs), [], `example ${ex.name} output`);
      for (const e of h.events) {
        assert.ok(cap.emits.includes(e.name), `${e.name} is declared in emits of ${cap.name}`);
        const schema = eventSchemas.get(e.name);
        assert.ok(schema, `${e.name} has a schema`);
        assert.deepEqual(validate(schema, e.payload, "", defs), [], `${e.name} payload`);
      }
    }
  });
  test(`${name}: real handler answers the schema sample, and every declared event is emitted`, async () => {
    const input = sample(cap.input, 0, defs);
    assert.deepEqual(validate(cap.input, input, "", defs), []);
    const { h, ctx } = await worldFor(cap.name);
    const out = await run(cap.name, ctx, input);
    assert.deepEqual(validate(cap.output, out, "", defs), []);
    assert.deepEqual([...new Set(h.events.map((e) => e.name))].sort(), [...cap.emits].sort());
  });
}
