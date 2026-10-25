// The generated contract for documents, run against the REAL handlers: the same example inputs the stub answered with (generated/modules/documents/stub-impl.ts) and the
// schema samples, each answer checked against the registry's schemas. This is the evidence for flipping documents to live (ARCH 12.4).
// @reads /generated/registry.json
// @reads /modules/documents/migrations/0001_documents.sql

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sample, validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { handlers } from "../impl.ts";
import { docx, para, world } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";

interface RegCap {
  name: string; module: string; v: number; input: JsonSchema; output: JsonSchema; emits: string[];
  examples: { name: string; input: unknown; output: unknown }[];
}
interface RegEvent { name: string; module: string; payload: JsonSchema }
interface Registry { $defs: Record<string, JsonSchema>; capabilities: RegCap[]; events: RegEvent[] }

const registry = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as Registry;
const defs = registry.$defs;
const caps = registry.capabilities.filter((c) => c.module === "documents");
const eventSchemas = new Map(registry.events.filter((e) => e.module === "documents").map((e) => [e.name, e.payload]));

type Fn = (ctx: Ctx, input: never) => Promise<unknown>;
const run = (name: string, ctx: Ctx, input: unknown): Promise<unknown> => {
  const fn = (handlers as unknown as Record<string, Fn>)[name];
  assert.ok(fn, `a handler for ${name}`);
  return fn(ctx, input as never);
};

/** A Space with the file and folder the examples name: a Word template that asks for nothing, and a record. */
function populated(): World {
  const w = world();
  w.add("Template.docx", docx(para("Static line")), "fld_a1b2c3", "fil_a1b2c3");
  w.records.set("rec_a1b2c3", { name: "Example" });
  return w;
}

test("a real handler exists for exactly the capabilities the registry declares for documents", () => {
  assert.equal(caps.length, 5);
  assert.deepEqual(Object.keys(handlers).sort(), caps.map((c) => c.name).sort());
});

for (const cap of caps) {
  const name = `${cap.name}@${cap.v}`;

  test(`${name}: real handler answers the example input with a valid output`, async () => {
    assert.ok(cap.examples.length >= 1);
    for (const ex of cap.examples) {
      assert.deepEqual(validate(cap.input, ex.input, "", defs), [], `example ${ex.name} input is valid`);
      const w = populated();
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
    const out = await run(cap.name, populated().ctx, input);
    assert.deepEqual(validate(cap.output, out, "", defs), []);
  });
}

test("every declared event is emitted by the handler that declares it", async () => {
  const emitted = async (cap: string, input: unknown): Promise<string[]> => {
    const w = populated();
    await run(cap, w.ctx, input);
    for (const e of w.events) assert.deepEqual(validate(eventSchemas.get(e.name)!, e.payload, "", defs), [], `${e.name} payload`);
    return [...new Set(w.events.map((e) => e.name))].sort();
  };
  assert.deepEqual(await emitted("documents.fill", { templateFileId: "fil_a1b2c3", intoFolderId: "fld_a1b2c3" }), ["document.filled"]);
  assert.deepEqual(await emitted("documents.mark_template", { fileId: "fil_a1b2c3", isTemplate: true }), ["document.template_marked"]);
  for (const c of caps.filter((x) => x.emits.length === 0)) assert.deepEqual(await emitted(c.name, sample(c.input, 0, defs)), [], c.name);
  const union = new Set(caps.flatMap((c) => c.emits));
  for (const e of union) assert.ok(registry.events.some((x) => x.name === e), `${e} is in the registry`);
  assert.ok(union.has("document.filled") && union.has("document.template_marked"));
});
