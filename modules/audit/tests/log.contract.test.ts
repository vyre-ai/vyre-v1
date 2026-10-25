// The generated contract for audit, run against the REAL handlers: the same example inputs the stub answered, outputs and events checked against the registry.
// This is the evidence for flipping audit to live (ARCH 12.4); the flip itself is P-L7_LIVE (ruling 25).
// @reads /generated/registry.json
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { ed25519Signer } from "../../../kernel/src/audit/index.ts";
import { sample, validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";
import { harness, NOW } from "../fixtures/db.ts";
import { appendRow } from "../projections.ts";
import type { AuditCtx } from "../projections.ts";
import { handlers } from "../impl.ts";

interface RegCap { name: string; module: string; v: number; input: JsonSchema; output: JsonSchema; emits: string[]; examples: { name: string; input: unknown; output: unknown }[] }
interface RegEvent { name: string; module: string; payload: JsonSchema }
interface Registry { $defs: Record<string, JsonSchema>; capabilities: RegCap[]; events: RegEvent[] }
const registry = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as Registry;
const defs = registry.$defs;
const caps = registry.capabilities.filter((c) => c.module === "audit");
const eventSchemas = new Map(registry.events.filter((e) => e.module === "audit").map((e) => [e.name, e.payload]));

const keys = generateKeyPairSync("ed25519");

type Fn = (ctx: AuditCtx, input: never) => Promise<unknown>;
const run = (name: string, ctx: AuditCtx, input: unknown): Promise<unknown> => {
  const fn = (handlers as Record<string, Fn>)[name];
  assert.ok(fn, `a handler for ${name}`);
  return fn(ctx, input as never);
};

/** A Space with four audited acts (the first under the id the examples use), a signed checkpoint, and every host seam wired. */
async function populated() {
  const h = harness(NOW - 10_000);
  const seams = {
    signer: { keyId: "key_space_1", sign: ed25519Signer(keys.privateKey), publicKey: keys.publicKey },
    archive: { async write(year: number, lines: string[]) { return { file: `audit-archive/${year}.jsonl.zst`, sizeBytes: lines.join("\n").length }; } },
    exports: { async save(_name: string, _csv: string) { return "fil_a1b2c3"; } },
  };
  const ctx = h.as("usr_a1b2c3", seams);
  appendRow(ctx, { actor: { kind: "person", id: "usr_a1b2c3" }, action: "grant.created", class: "change", resource: { type: "space", id: "spc_test" }, after: { level: "view" } }, "aud_a1b2c3");
  h.advance(1000);
  appendRow(ctx, { actor: { kind: "person", id: "usr_a1b2c3" }, onBehalfOf: { kind: "person", id: "usr_boss" }, action: "role.assigned", class: "admin" });
  h.advance(1000);
  appendRow(ctx, { actor: { kind: "agent", id: "agt_a1b2c3" }, action: "vault.revealed", class: "sensitive" });
  await handlers["audit.checkpoint"](ctx, {});
  // one row after the checkpoint, so the head is new and audit.checkpoint has something to sign
  h.advance(1000);
  appendRow(ctx, { actor: { kind: "person", id: "usr_a1b2c3" }, action: "policy.changed", class: "admin" });
  h.advance(6000);
  h.events.length = 0;
  return { h, ctx };
}

test("a real handler exists for exactly the capabilities the registry declares for audit", () => {
  assert.equal(caps.length, 10);
  assert.deepEqual(Object.keys(handlers).sort(), caps.map((c) => c.name).sort());
});

for (const cap of caps) {
  const name = `${cap.name}@${cap.v}`;
  test(`${name}: real handler answers the example input with a valid output and declared events`, async () => {
    assert.ok(cap.examples.length >= 1);
    for (const ex of cap.examples) {
      assert.deepEqual(validate(cap.input, ex.input, "", defs), [], `example ${ex.name} input is valid`);
      const { h, ctx } = await populated();
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
    const { h, ctx } = await populated();
    const out = await run(cap.name, ctx, input);
    assert.deepEqual(validate(cap.output, out, "", defs), []);
    assert.deepEqual([...new Set(h.events.map((e) => e.name))].sort(), [...cap.emits].sort());
  });
}
