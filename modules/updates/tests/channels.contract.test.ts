// The generated contract for updates, run against the REAL handlers: the same example inputs and outputs the stub answered with
// (generated/modules/updates/stub-impl.ts), checked against the registry's schemas. This is the evidence for flipping updates to live (ARCH 12.4).
// @reads /generated/registry.json
// @reads ../migrations/0001_init.sql

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sample, validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";
import { world } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";
import { configureUpdates, handlers } from "../handlers/index.ts";
import type { UpdateCtx } from "../handlers/index.ts";

interface RegCap {
  name: string; module: string; v: number; input: JsonSchema; output: JsonSchema; emits: string[];
  examples: { name: string; input: unknown; output: unknown }[];
}
interface RegEvent { name: string; module: string; payload: JsonSchema }
interface Registry { $defs: Record<string, JsonSchema>; capabilities: RegCap[]; events: RegEvent[] }

const registry = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as Registry;
const defs = registry.$defs;
const caps = registry.capabilities.filter((c) => c.module === "updates");
const eventSchemas = new Map(registry.events.filter((e) => e.module === "updates").map((e) => [e.name, e.payload]));

type Fn = (ctx: UpdateCtx, input: never) => Promise<unknown>;
const run = (name: string, ctx: UpdateCtx, input: unknown): Promise<unknown> => {
  const fn = (handlers as unknown as Record<string, Fn>)[name];
  assert.ok(fn, `a handler for ${name}`);
  return fn(ctx, input as never);
};

/** A server on 1.2.0 that keeps 1.1.0 and 1.0.0, with a signed 1.3.0 on the stable channel, one update already in the history, and a backup module that works. */
async function populated(): Promise<World> {
  const w = await world({ version: "1.2.0" });
  configureUpdates(w.drivers);
  await w.publish({ version: "1.3.0", notes: "Faster sync.", apps: { mac: "1.3.0", ios: "1.2.0" } });
  await run("updates.check", w.ctx, {});
  w.raw.run("INSERT INTO updates_history (id, at, from_version, to_version, result, seconds, backup_id, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", "run_seed1", 1, "1.1.0", "1.2.0", "ok", 42, null, null);
  w.events.length = 0;
  w.backups.calls.length = 0;
  return w;
}

/** The examples and schema samples ask apply for "1.0.0", the only release it may install, so for apply the server runs 0.9.0 and the feed offers 1.0.0. */
async function populatedFor(cap: string): Promise<World> {
  const w = await populated();
  if (cap === "updates.apply") {
    w.installer.version = "0.9.0";
    await w.publish({ version: "1.0.0" });
  }
  return w;
}

afterEach(() => configureUpdates(null));

test("a real handler exists for exactly the capabilities the registry declares for updates", () => {
  assert.equal(caps.length, 8);
  assert.deepEqual(Object.keys(handlers).sort(), caps.map((c) => c.name).sort());
});

for (const cap of caps) {
  const name = `${cap.name}@${cap.v}`;

  test(`${name}: real handler answers the example input with a valid output`, async () => {
    assert.ok(cap.examples.length >= 1);
    for (const ex of cap.examples) {
      assert.deepEqual(validate(cap.input, ex.input, "", defs), [], `example ${ex.name} input is valid`);
      const w = await populatedFor(cap.name);
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
    const w = await populatedFor(cap.name);
    const out = await run(cap.name, w.ctx, input);
    assert.deepEqual(validate(cap.output, out, "", defs), []);
  });
}

test("every declared event is emitted by the handler that declares it", async () => {
  const emitted = async (cap: string, input: unknown, prep?: (w: World) => void): Promise<string[]> => {
    const w = await populated();
    prep?.(w);
    await run(cap, w.ctx, input);
    for (const e of w.events) assert.deepEqual(validate(eventSchemas.get(e.name)!, e.payload, "", defs), [], `${e.name} payload`);
    return [...new Set(w.events.map((e) => e.name))].sort();
  };
  assert.deepEqual(await emitted("updates.apply", {}), ["update.completed", "update.started"]);
  assert.deepEqual(await emitted("updates.apply", {}, (w) => { w.installer.health = [false]; }), ["update.failed", "update.started"]);
  assert.deepEqual(await emitted("updates.rollback", { to: "1.1.0" }), ["update.rolled_back"]);
  for (const c of caps.filter((x) => x.emits.length === 0)) assert.deepEqual(await emitted(c.name, sample(c.input, 0, defs)), [], c.name);
  assert.deepEqual([...new Set(caps.flatMap((c) => c.emits))].sort(), ["update.completed", "update.failed", "update.rolled_back", "update.started"]);
});
