// The generated contract for logs, run against the REAL handlers: the same example inputs and outputs the stub answered with
// (generated/modules/logs/stub-impl.ts), checked against the registry's schemas. This is the evidence for flipping logs to live (ARCH 12.4).
// @reads /generated/registry.json
// @reads ../migrations/0001_init.sql

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sample, validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";
import { harness, NOW, SPACE } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { LogWriter } from "../handlers/sink.ts";
import { handlers } from "../handlers/index.ts";
import type { LogCtx } from "../handlers/index.ts";

interface RegCap {
  name: string; module: string; v: number; input: JsonSchema; output: JsonSchema; emits: string[];
  examples: { name: string; input: unknown; output: unknown }[];
}
interface RegEvent { name: string; module: string; payload: JsonSchema }
interface Registry { $defs: Record<string, JsonSchema>; capabilities: RegCap[]; events: RegEvent[] }

const registry = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as Registry;
const defs = registry.$defs;
const caps = registry.capabilities.filter((c) => c.module === "logs");
const eventSchemas = new Map(registry.events.filter((e) => e.module === "logs").map((e) => [e.name, e.payload]));

type Fn = (ctx: LogCtx, input: never) => Promise<unknown>;
const run = (name: string, ctx: LogCtx, input: unknown): Promise<unknown> => {
  const fn = (handlers as Record<string, Fn>)[name];
  assert.ok(fn, `a handler for ${name}`);
  return fn(ctx, input as never);
};

/** A Space with one fully populated row, a span, an event and a replay, so every optional output field is exercised. */
function populated(): Harness {
  const h = harness();
  const w = new LogWriter({ db: h.raw, space: SPACE, now: () => NOW, batchMs: 0, minLevel: "debug" });
  w.write({
    msg: "record.updated", at: NOW - 10, level: "warn", traceId: "0123456789abcdef0123456789abcdef", spanId: "abcdef0123456789", actor: "usr_owner",
    onBehalf: "usr_ana", runId: "run_a1b2c3", place: "records", cap: "records.update", entity: "record", entityId: "rec_a1b2c3", result: "ok",
    durMs: 4.5, costMicros: 12, label: 2, attrs: { count: 3, ids: ["rec_a1b2c3"] },
  });
  w.span({ traceId: "0123456789abcdef0123456789abcdef", spanId: "abcdef0123456789", parent: "1111111111111111", name: "invoke.handler", at: NOW - 12, durUs: 3000, attrs: { cap: "records.update" } });
  w.event({ traceId: "0123456789abcdef0123456789abcdef", seq: 5, type: "record.updated", at: NOW - 11, actor: "usr_owner", entity: "record/rec_a1b2c3" });
  h.raw.run(
    "INSERT INTO logs_replay (id, space, at_seq, run_id, conflict_id, state, recorded_outward, steps, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "rpl_a1b2c3", SPACE, 1, null, null, "done", 2, JSON.stringify([{ name: "copy", ok: true, detail: "1 events up to 1" }, { name: "seal", ok: true }]), NOW,
  );
  return h;
}

test("a real handler exists for exactly the capabilities the registry declares for logs", () => {
  assert.equal(caps.length, 10);
  assert.deepEqual(Object.keys(handlers).sort(), caps.map((c) => c.name).sort());
});

/** An empty Space and a populated one; a replay can only be read where one exists. */
const spacesFor = (cap: string): Harness[] => (cap === "logs.replay_get" ? [populated()] : [harness(), populated()]);

for (const cap of caps) {
  const name = `${cap.name}@${cap.v}`;

  test(`${name}: real handler answers the example input with a valid output`, async () => {
    assert.ok(cap.examples.length >= 1);
    for (const ex of cap.examples) {
      assert.deepEqual(validate(cap.input, ex.input, "", defs), [], `example ${ex.name} input is valid`);
      for (const h of spacesFor(cap.name)) {
        const out = await run(cap.name, h.ctx, ex.input);
        assert.deepEqual(validate(cap.output, out, "", defs), [], `example ${ex.name} output`);
        for (const e of h.events) {
          assert.ok(cap.emits.includes(e.name), `${e.name} is declared in emits of ${cap.name}`);
          const schema = eventSchemas.get(e.name);
          assert.ok(schema, `${e.name} has a schema`);
          assert.deepEqual(validate(schema, e.payload, "", defs), [], `${e.name} payload`);
        }
      }
    }
  });

  test(`${name}: real handler answers the schema sample with a valid output`, async () => {
    const input = sample(cap.input, 0, defs);
    assert.deepEqual(validate(cap.input, input, "", defs), []);
    for (const h of spacesFor(cap.name)) {
      const out = await run(cap.name, h.ctx, input);
      assert.deepEqual(validate(cap.output, out, "", defs), []);
    }
  });

  test(`${name}: every declared event is emitted by the handler that declares it`, async () => {
    const h = populated();
    await run(cap.name, h.ctx, sample(cap.input, 0, defs));
    assert.deepEqual([...new Set(h.events.map((e) => e.name))].sort(), [...cap.emits].sort());
  });
}

test("query, trace and export answer a populated Space in the declared shape", async () => {
  const h = populated();
  const q = await run("logs.query", h.ctx, {}) as { rows: unknown[]; total: number };
  assert.equal(q.total, 1);
  const out = await run("logs.trace", h.ctx, { traceId: "0123456789abcdef0123456789abcdef" });
  const tc = caps.find((c) => c.name === "logs.trace")!;
  assert.deepEqual(validate(tc.output, out, "", defs), []);
  const t = out as { logs: unknown[]; spans: unknown[]; events: unknown[] };
  assert.deepEqual([t.logs.length, t.spans.length, t.events.length], [1, 1, 1]);
  const qc = caps.find((c) => c.name === "logs.query")!;
  assert.deepEqual(validate(qc.output, q, "", defs), []);
  const r = await run("logs.replay_get", h.ctx, { replayId: "rpl_a1b2c3" }) as { state: string; recordedOutward: number; steps: unknown[] };
  assert.deepEqual([r.state, r.recordedOutward, r.steps.length], ["done", 2, 2]);
});
