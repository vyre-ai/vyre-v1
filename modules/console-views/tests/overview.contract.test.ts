// The generated contract for console-views, run against the REAL handlers: the same example inputs the stub answered, outputs checked against the registry schemas.
// Run on the final commit of this packet, after merging main, so the CI log lists this file as ok.
// This is the evidence for flipping console-views to live (ARCH 12.4); the flip itself is P-L7b_LIVE (ruling 25).
// @reads /generated/registry.json
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sample, validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";
import { handlers } from "../impl.ts";
import { DAY, NOW, quiet, world } from "../fixtures/db.ts";

interface RegCap { name: string; module: string; v: number; input: JsonSchema; output: JsonSchema; emits: string[]; examples: { name: string; input: unknown; output: unknown }[] }
interface Registry { $defs: Record<string, JsonSchema>; capabilities: RegCap[] }
const registry = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as Registry;
const defs = registry.$defs;
const caps = registry.capabilities.filter((c) => c.module === "console-views");

const tr = "0123456789abcdef0123456789abcdef";
/** A busy Space, so every optional output field is exercised, and a quiet one. */
function busy() {
  return world({
    ...quiet,
    "health.status": { overall: "degraded", checks: [{ key: "sync.lag", title: "Sync lag", state: "degraded", checkedAt: NOW, module: "sync", next: "Check the relay." }] },
    "network.status": { address: "a.example", mode: "relay", certificate: { host: "a.example", expiresAt: NOW + DAY, state: "degraded" }, publicIngress: true },
    "runs.list": { runs: [{ id: "run_a1b2c3", kind: "automation", status: "failed", startedAt: NOW - 1000, traceId: tr }] },
    "audit.list": { rows: [{ at: NOW, actor: { kind: "person", id: "usr_a" }, action: "grant.created", resource: { type: "folder", id: "fld_1" } }] },
    "engine.usage.query": { rows: [{ key: "agt_a", title: "Scout", totals: { turns: 2, tokensIn: 3, tokensOut: 4, costMicros: 5 } }], totals: { turns: 2, tokensIn: 3, tokensOut: 4, costMicros: 5 } },
    "access.principals.list": { principals: [], total: 3 },
    "logs.spans": { spans: [{ traceId: tr, spanId: "ab12", name: "navigate", at: NOW - 10, durUs: 12000 }] },
  }, ["console.access", "access.manage"]);
}

type Fn = (ctx: ReturnType<typeof busy>["ctx"], input: never) => Promise<unknown>;
const run = (name: string, ctx: ReturnType<typeof busy>["ctx"], input: unknown): Promise<unknown> => {
  const fn = (handlers as Record<string, Fn>)[name];
  assert.ok(fn, `a handler for ${name}`);
  return fn(ctx, input as never);
};

test("a real handler exists for exactly the capabilities the registry declares for console-views", () => {
  assert.equal(caps.length, 6);
  assert.deepEqual(Object.keys(handlers).sort(), caps.map((c) => c.name).sort());
  for (const c of caps) assert.deepEqual(c.emits, [], `${c.name} is a read and emits nothing`);
});

for (const cap of caps) {
  const name = `${cap.name}@${cap.v}`;
  test(`${name}: real handler answers the example input with a valid output`, async () => {
    assert.ok(cap.examples.length >= 1);
    for (const ex of cap.examples) {
      assert.deepEqual(validate(cap.input, ex.input, "", defs), [], `example ${ex.name} input is valid`);
      for (const w of [busy(), world(quiet)]) {
        assert.deepEqual(validate(cap.output, await run(cap.name, w.ctx, ex.input), "", defs), [], `example ${ex.name} output`);
      }
    }
  });
  test(`${name}: real handler answers the schema sample with a valid output`, async () => {
    const input = sample(cap.input, 0, defs);
    assert.deepEqual(validate(cap.input, input, "", defs), []);
    for (const w of [busy(), world(quiet)]) {
      assert.deepEqual(validate(cap.output, await run(cap.name, w.ctx, input), "", defs), []);
    }
  });
}
