// The generated contract for health, run against the REAL handlers: the same example inputs and outputs the stub answered with
// (generated/modules/health/stub-impl.ts), checked against the registry's schemas. This is the evidence for flipping health to live (ARCH 12.4).
// @reads /generated/registry.json
// @reads ../migrations/0001_init.sql

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sample, validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";
import { harness, NOW } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { reportProbe, runChecks, setDefsProvider } from "../handlers/checks.ts";
import type { HealthDef } from "../handlers/checks.ts";
import { handlers } from "../handlers/index.ts";
import type { HealthCtx } from "../handlers/index.ts";
import { reportService } from "../handlers/services.ts";

interface RegCap {
  name: string; module: string; v: number; input: JsonSchema; output: JsonSchema; emits: string[];
  examples: { name: string; input: unknown; output: unknown }[];
}
interface RegEvent { name: string; module: string; payload: JsonSchema }
interface Registry { $defs: Record<string, JsonSchema>; capabilities: RegCap[]; events: RegEvent[] }

const registry = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as Registry;
const defs = registry.$defs;
const caps = registry.capabilities.filter((c) => c.module === "health");
const eventSchemas = new Map(registry.events.filter((e) => e.module === "health").map((e) => [e.name, e.payload]));

/** The schema examples name a check "example" and a service "example"; the Space under test has both. */
const exampleDef: HealthDef = {
  key: "example", title: "Example check", cap: "example.probe", module: "example", intervalSec: 60, timeoutMs: 100,
  states: { downWhen: "state == 'down'" }, pauses: ["sync"], next: "Do the example thing, then run the check again.",
};

type Fn = (ctx: HealthCtx, input: never) => Promise<unknown>;
const run = (name: string, ctx: HealthCtx, input: unknown): Promise<unknown> => {
  const fn = (handlers as unknown as Record<string, Fn>)[name];
  assert.ok(fn, `a handler for ${name}`);
  return fn(ctx, input as never);
};

/** A Space with a recorded failing check, a pause, a probe report, a service, and answers for what a bundle asks. */
async function populated(): Promise<Harness> {
  const h = harness();
  h.answer(exampleDef.cap, { state: "down", detail: "example failure", latencyMs: 12 });
  await runChecks(h.ctx, [exampleDef]);
  for (const name of ["disk_encrypted", "events_db", "index_db", "scheduler", "docker", "caddy", "disk_space", "time_skew"]) reportProbe(h.ctx, name, { state: "healthy", latencyMs: 3, values: { freeBytes: 9_000_000_000, skewMs: 10 } });
  reportService(h.ctx, "example", { state: "healthy", restarts: 2 });
  h.answer("updates.status", { current: "1.0.0" });
  h.answer("logs.query", { rows: [], total: 0 });
  h.answer("logs.trace", { logs: [], spans: [], events: [] });
  h.events.length = 0;
  h.calls.length = 0;
  return h;
}

const spaces = async (): Promise<Harness[]> => {
  const empty = harness();
  empty.answer(exampleDef.cap, { state: "healthy" });
  return [empty, await populated()];
};

test("a real handler exists for exactly the capabilities the registry declares for health", () => {
  assert.equal(caps.length, 16);
  assert.deepEqual(Object.keys(handlers).sort(), caps.map((c) => c.name).sort());
});

for (const cap of caps) {
  const name = `${cap.name}@${cap.v}`;

  test(`${name}: real handler answers the example input with a valid output`, async () => {
    setDefsProvider(() => [exampleDef]);
    assert.ok(cap.examples.length >= 1);
    for (const ex of cap.examples) {
      assert.deepEqual(validate(cap.input, ex.input, "", defs), [], `example ${ex.name} input is valid`);
      for (const h of await spaces()) {
        reportService(h.ctx, "example", { state: "healthy" });
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
    setDefsProvider(null);
  });

  test(`${name}: real handler answers the schema sample with a valid output`, async () => {
    setDefsProvider(() => [exampleDef]);
    const input = sample(cap.input, 0, defs);
    assert.deepEqual(validate(cap.input, input, "", defs), []);
    for (const h of await spaces()) {
      reportService(h.ctx, "example", { state: "healthy" });
      const out = await run(cap.name, h.ctx, input);
      assert.deepEqual(validate(cap.output, out, "", defs), []);
    }
    setDefsProvider(null);
  });

  test(`${name}: every declared event is emitted by the handler that declares it`, async () => {
    const h = await populated();
    if (cap.name === "health.run") {
      // one run that changes a state, pauses a new failure and resumes a recovered check: all three events
      const second: HealthDef = { ...exampleDef, key: "example2", title: "Second example", cap: "example2.probe", pauses: ["sync"] };
      setDefsProvider(() => [exampleDef, second]);
      h.answer(exampleDef.cap, { state: "healthy" });
      h.answer(second.cap, { state: "down", detail: "second failure" });
      await run(cap.name, h.ctx, {});
    } else {
      setDefsProvider(() => [exampleDef]);
      await run(cap.name, h.ctx, sample(cap.input, 0, defs));
    }
    assert.deepEqual([...new Set(h.events.map((e) => e.name))].sort(), [...cap.emits].sort());
    setDefsProvider(null);
  });
}

test("status, doctor, history and paused reasons answer a populated Space in the declared shape", async () => {
  setDefsProvider(() => [exampleDef]);
  const h = await populated();
  const status = await run("health.status", h.ctx, {}) as { overall: string; checks: { key: string; next: string }[] };
  assert.deepEqual([status.overall, status.checks.map((c) => c.key)], ["down", ["example"]]);
  const doctor = await run("health.doctor", h.ctx, {}) as { ok: boolean; findings: { key: string; next: string }[] };
  assert.equal(doctor.ok, false);
  assert.deepEqual(doctor.findings.map((f) => [f.key, f.next]), [["example", exampleDef.next]]);
  const hist = await run("health.history", h.ctx, { key: "example", sinceMs: NOW - 1000 }) as { samples: unknown[] };
  assert.ok(hist.samples.length >= 1);
  assert.deepEqual(await run("health.paused_reasons", h.ctx, {}), { paused: [{ area: "sync", key: "example", reason: "Example check is down: example failure. Do the example thing, then run the check again." }] });
  setDefsProvider(null);
});
