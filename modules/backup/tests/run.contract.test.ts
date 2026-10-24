// The generated contract for backup, run against the REAL handlers: the same example inputs and outputs the stub answered with Run in CI.
// (generated/modules/backup/stub-impl.ts), checked against the registry's schemas. This is the evidence for flipping backup to live (ARCH 12.4).
// @reads /generated/registry.json
// @reads ../migrations/0001_init.sql

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sample, validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";
import { MEMORY_TARGET, seedBackup, world } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";
import { configureBackup, handlers } from "../handlers/index.ts";
import type { BackupCtx } from "../handlers/index.ts";

interface RegCap {
  name: string; module: string; v: number; input: JsonSchema; output: JsonSchema; emits: string[];
  examples: { name: string; input: unknown; output: unknown }[];
}
interface RegEvent { name: string; module: string; payload: JsonSchema }
interface Registry { $defs: Record<string, JsonSchema>; capabilities: RegCap[]; events: RegEvent[] }

const registry = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as Registry;
const defs = registry.$defs;
const caps = registry.capabilities.filter((c) => c.module === "backup");
const eventSchemas = new Map(registry.events.filter((e) => e.module === "backup").map((e) => [e.name, e.payload]));

/** The id every example and schema sample names. */
const EXAMPLE_BACKUP = "bkp_a1b2c3";

type Fn = (ctx: BackupCtx, input: never) => Promise<unknown>;
const run = (name: string, ctx: BackupCtx, input: unknown): Promise<unknown> => {
  const fn = (handlers as unknown as Record<string, Fn>)[name];
  assert.ok(fn, `a handler for ${name}`);
  return fn(ctx, input as never);
};

/** A Space with two records, a blob, a backup target, and a backup under the id the examples use. Handlers are wired to its drivers. */
async function populated(): Promise<World> {
  const w = world();
  configureBackup(w.drivers);
  await w.space.append("contact/ada", "Ada Lovelace");
  await w.space.append("contact/bob", "Bob Barker");
  w.space.blobs.set("fil_1", "the engagement letter");
  w.space.vault.set("MAILGUN_KEY", "key-9f8e7d6c5b4a39281706");
  await seedBackup(w, EXAMPLE_BACKUP);
  w.events.length = 0;
  return w;
}

afterEach(() => configureBackup(null));

test("a real handler exists for exactly the capabilities the registry declares for backup", () => {
  assert.equal(caps.length, 10);
  assert.deepEqual(Object.keys(handlers).sort(), caps.map((c) => c.name).sort());
});

for (const cap of caps) {
  const name = `${cap.name}@${cap.v}`;

  test(`${name}: real handler answers the example input with a valid output`, async () => {
    assert.ok(cap.examples.length >= 1);
    for (const ex of cap.examples) {
      assert.deepEqual(validate(cap.input, ex.input, "", defs), [], `example ${ex.name} input is valid`);
      const w = await populated();
      const out = await run(cap.name, w.ctx, ex.input);
      assert.deepEqual(validate(cap.output, out, "", defs), [], `example ${ex.name} output`);
      for (const e of w.events.filter((x) => !w.nested.includes(x))) {
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
    const w = await populated();
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
  assert.deepEqual(await emitted("backup.run", {}), ["backup.completed"]);
  assert.deepEqual(await emitted("backup.run", {}, (w) => { w.space.failSnapshot = true; }), ["backup.failed"]);
  assert.deepEqual(await emitted("backup.config_set", { target: MEMORY_TARGET, schedule: "0 3 * * *", enabled: true }), ["backup.config_changed"]);
  assert.deepEqual(await emitted("backup.verify", { backupId: EXAMPLE_BACKUP }), ["backup.verified"]);
  // restore: the safety backup is announced by backup.run, the restore by backup.restored
  assert.deepEqual(await emitted("backup.restore", { backupId: EXAMPLE_BACKUP, confirm: true }), ["backup.completed", "backup.restored"]);
  // the other capabilities declare no events and emit none
  for (const c of caps.filter((x) => x.emits.length === 0)) assert.deepEqual(await emitted(c.name, sample(c.input, 0, defs)), [], c.name);
  // and the events each capability declares are all in the registry
  const union = new Set(caps.flatMap((c) => c.emits));
  assert.deepEqual([...union].sort(), ["backup.completed", "backup.config_changed", "backup.failed", "backup.restored", "backup.verified"]);
});

test("config, health and list answer a Space that has no target yet", async () => {
  const w = world();
  configureBackup(w.drivers);
  const cfg = await run("backup.config_get", w.ctx, {});
  assert.deepEqual(validate(caps.find((c) => c.name === "backup.config_get")!.output, cfg, "", defs), []);
  const health = await run("backup.health", w.ctx, {});
  assert.deepEqual(validate(caps.find((c) => c.name === "backup.health")!.output, health, "", defs), []);
  const list = await run("backup.list", w.ctx, {});
  assert.deepEqual(validate(caps.find((c) => c.name === "backup.list")!.output, list, "", defs), []);
});

test("restore and verify of a populated Space leave the data intact and the Space readable", async () => {
  const w = await populated();
  const before = await w.space.snapshot();
  assert.deepEqual(await run("backup.verify", w.ctx, { backupId: EXAMPLE_BACKUP }), { ok: true, checkedEvents: 2 });
  await run("backup.restore", w.ctx, { backupId: EXAMPLE_BACKUP, confirm: true });
  assert.equal((await w.space.snapshot()).headHash, before.headHash);
});
