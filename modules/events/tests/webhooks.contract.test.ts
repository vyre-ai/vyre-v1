// The generated contract for events, run against the REAL handlers: the same example inputs the stub answered, outputs and events checked against the registry.
// This is the evidence for flipping events to live (ARCH 12.4); the flip itself is a one-line edit of host/modules.json (ruling 25).
// @reads /generated/registry.json
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sample, validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";
import { harness, seedExampleWorld } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { handlers } from "../impl.ts";
import type { EventsCtx } from "../handlers/index.ts";

interface RegCap { name: string; module: string; v: number; input: JsonSchema; output: JsonSchema; emits: string[]; examples: { name: string; input: unknown; output: unknown }[] }
interface RegEvent { name: string; module: string; payload: JsonSchema }
interface Registry { $defs: Record<string, JsonSchema>; capabilities: RegCap[]; events: RegEvent[] }
const registry = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as Registry;
const defs = registry.$defs;
const caps = registry.capabilities.filter((c) => c.module === "events");
const eventSchemas = new Map(registry.events.filter((e) => e.module === "events").map((e) => [e.name, e.payload]));

type Fn = (ctx: EventsCtx, input: never) => Promise<unknown>;
const run = (name: string, ctx: EventsCtx, input: unknown): Promise<unknown> => {
  const fn = (handlers as Record<string, Fn>)[name];
  assert.ok(fn, `a handler for ${name}`);
  return fn(ctx, input as never);
};

/** The webhook, delivery and event the examples name, asked for by the admin who owns them. System calls (the consumer's send_delivery) run as the service. */
function worldFor(cap: string): { h: Harness; ctx: EventsCtx } {
  const h = harness();
  seedExampleWorld(h);
  return { h, ctx: cap === "webhooks.send_delivery" ? h.system() : h.as("usr_a1b2c3") };
}

test("a real handler exists for exactly the capabilities the registry declares for events", () => {
  assert.equal(caps.length, 16);
  assert.deepEqual(Object.keys(handlers).sort(), caps.map((c) => c.name).sort());
});

function checkEvents(cap: RegCap, h: Harness): void {
  for (const e of h.emitted) {
    assert.ok(cap.emits.includes(e.name), `${e.name} is declared in emits of ${cap.name}`);
    const schema = eventSchemas.get(e.name);
    assert.ok(schema, `${e.name} has a schema`);
    assert.deepEqual(validate(schema, e.payload, "", defs), [], `${e.name} payload`);
  }
}

for (const cap of caps) {
  const name = `${cap.name}@${cap.v}`;
  test(`${name}: real handler answers the example input with a valid output and declared events`, async () => {
    assert.ok(cap.examples.length >= 1);
    for (const ex of cap.examples) {
      assert.deepEqual(validate(cap.input, ex.input, "", defs), [], `example ${ex.name} input is valid`);
      const { h, ctx } = worldFor(cap.name);
      const out = await run(cap.name, ctx, ex.input);
      assert.deepEqual(validate(cap.output, out, "", defs), [], `example ${ex.name} output`);
      checkEvents(cap, h);
    }
  });
  test(`${name}: real handler answers the schema sample, and every event it emits is declared`, async () => {
    const input = sample(cap.input, 0, defs);
    assert.deepEqual(validate(cap.input, input, "", defs), []);
    const { h, ctx } = worldFor(cap.name);
    const out = await run(cap.name, ctx, input);
    assert.deepEqual(validate(cap.output, out, "", defs), []);
    checkEvents(cap, h);
  });
}

test("the capabilities that must emit do: create, update, delete and rotate each emit their one event", async () => {
  const want: Record<string, string> = { "webhooks.create": "webhook.created", "webhooks.update": "webhook.updated", "webhooks.delete": "webhook.deleted", "webhooks.rotate_secret": "webhook.secret_rotated" };
  for (const [capName, evName] of Object.entries(want)) {
    const cap = caps.find((c) => c.name === capName)!;
    const input = sample(cap.input, 0, defs) as Record<string, unknown>;
    if (capName === "webhooks.update") input["name"] = "Renamed";   // the sample may repeat the stored values; a rename is a change
    const { h, ctx } = worldFor(capName);
    await run(capName, ctx, input);
    assert.deepEqual([...new Set(h.emitted.map((e) => e.name))], [evName], capName);
  }
});
