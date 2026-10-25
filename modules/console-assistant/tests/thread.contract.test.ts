// The generated contract for console-assistant, run against the REAL handlers: the same example inputs the stub answered, outputs and events checked against the registry.
// This is the evidence for flipping console-assistant to live (ARCH 12.4); the flip itself is P-L7b_LIVE (ruling 25).
// @reads /generated/registry.json
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sample, validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";
import { handlers } from "../impl.ts";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import type { AssistCtx } from "../projections.ts";

interface RegCap { name: string; module: string; v: number; input: JsonSchema; output: JsonSchema; emits: string[]; examples: { name: string; input: unknown; output: unknown }[] }
interface RegEvent { name: string; module: string; payload: JsonSchema }
interface Registry { $defs: Record<string, JsonSchema>; capabilities: RegCap[]; events: RegEvent[] }
const registry = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as Registry;
const defs = registry.$defs;
const caps = registry.capabilities.filter((c) => c.module === "console-assistant");
const eventSchemas = new Map(registry.events.filter((e) => e.module === "console-assistant").map((e) => [e.name, e.payload]));

const PERSON = "usr_a1b2c3";
const AGENT = "agt_a1b2c3";

/** A Space where the example ids exist: the person has an assistant, an open thread thr_a1b2c3, and (for Apply and Reject) the proposed card dif_a1b2c3. */
async function populated(withCard: boolean): Promise<{ h: Harness; ctx: AssistCtx }> {
  const h = harness({
    "agents.list": { agents: [{ agentId: AGENT, ownerId: PERSON, role: "assistant" }] },
    "chat.start": { threadId: "thr_a1b2c3" },
    "threads.update": { threadId: "thr_a1b2c3" },
    "settings.set_space": { key: "ui.density" },
    "audit.append": { auditId: "aud_a1b2c3" },
    "access.check": { decision: { effect: "allow", reason: "owner", decisionId: "dec_1", steps: [{ ok: true, text: "Owner holds every permission" }] } },
  });
  const ctx = h.as(PERSON);
  await handlers["console.assistant_open"](ctx, { page: "console.overview", idempotencyKey: "idem_seed" });
  if (withCard) {
    await handlers["console.diff_propose"](h.as(AGENT, "agent", PERSON), {
      threadId: "thr_a1b2c3", idempotencyKey: "idem_seed",
      diff: { diffId: "dif_a1b2c3", kind: "setting", title: "Use compact rows", changes: [{ path: "ui.density", before: "roomy", after: "compact" }] },
    });
  }
  h.events.length = 0;
  h.calls.length = 0;
  return { h, ctx };
}

type Fn = (ctx: AssistCtx, input: never) => Promise<unknown>;
const run = (name: string, ctx: AssistCtx, input: unknown): Promise<unknown> => {
  const fn = (handlers as Record<string, Fn>)[name];
  assert.ok(fn, `a handler for ${name}`);
  return fn(ctx, input as never);
};
const needsCard = (name: string): boolean => name === "console.diff_apply" || name === "console.diff_reject";

test("a real handler exists for exactly the capabilities the registry declares for console-assistant", () => {
  assert.equal(caps.length, 7);
  assert.deepEqual(Object.keys(handlers).sort(), caps.map((c) => c.name).sort());
});

for (const cap of caps) {
  const name = `${cap.name}@${cap.v}`;
  test(`${name}: real handler answers the example input with a valid output and declared events`, async () => {
    assert.ok(cap.examples.length >= 1);
    for (const ex of cap.examples) {
      assert.deepEqual(validate(cap.input, ex.input, "", defs), [], `example ${ex.name} input is valid`);
      const { h, ctx } = await populated(needsCard(cap.name));
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
    const { h, ctx } = await populated(needsCard(cap.name));
    const out = await run(cap.name, ctx, input);
    assert.deepEqual(validate(cap.output, out, "", defs), []);
    assert.deepEqual([...new Set(h.events.map((e) => e.name))].sort(), [...cap.emits].sort());
  });
}
