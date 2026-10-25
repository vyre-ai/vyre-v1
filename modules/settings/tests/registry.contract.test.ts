// The generated contract for settings, run against the REAL handlers: outputs and events checked against the registry for every capability, as the stub's examples are.
// This is the evidence for flipping settings to live (ARCH 12.4); the flip itself is P-L7_LIVE (ruling 25).
// The registry's example inputs name a setting "example", which is no setting, so each capability that takes a key is asked about a real one (INPUTS below). Adding `examples` to the
// manifest's key fields would let the generated test run unchanged; that is a CONTRACT-CHANGE for the contract steward, noted on the packet.
// @reads /generated/registry.json
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { handlers } from "../impl.ts";
import type { SettingsCtx } from "../handlers/index.ts";

interface RegCap { name: string; module: string; v: number; input: JsonSchema; output: JsonSchema; emits: string[]; examples: { name: string; input: unknown; output: unknown }[] }
interface RegEvent { name: string; module: string; payload: JsonSchema }
interface Registry { $defs: Record<string, JsonSchema>; capabilities: RegCap[]; events: RegEvent[] }
const registry = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as Registry;
const defs = registry.$defs;
const caps = registry.capabilities.filter((c) => c.module === "settings");
const eventSchemas = new Map(registry.events.filter((e) => e.module === "settings").map((e) => [e.name, e.payload]));

type Fn = (ctx: SettingsCtx, input: never) => Promise<unknown>;
const run = (name: string, ctx: SettingsCtx, input: unknown): Promise<unknown> => {
  const fn = (handlers as Record<string, Fn>)[name];
  assert.ok(fn, `a handler for ${name}`);
  return fn(ctx, input as never);
};

/** Inputs that name something real, where the generic example would not. */
const INPUTS: Record<string, unknown> = {
  "settings.get": { key: "profile.timezone" },
  "settings.set": { key: "profile.timezone", value: "Asia/Karachi" },
  "settings.set_space": { key: "profile.timezone", value: "Asia/Karachi" },
  "settings.reset": { key: "profile.timezone" },
  "settings.reset_space": { key: "profile.timezone" },
  "settings.floor_set": { key: "security.level", floor: "standard" },
  "settings.copy_profile": { fields: ["photo"], values: { photo: "fil_a1b2c3" } },
  "settings.search": { q: "time zone" },
  "settings.list": { page: "profile", scope: "person" },
};

/** Maya, an admin, with one value of her own and one of the Space's already set, so reset has something to put back. */
async function worldFor(cap: string): Promise<{ h: Harness; ctx: SettingsCtx }> {
  const h = harness();
  const ctx = h.as("usr_a1b2c3", { admin: true });
  if (cap === "settings.reset") await run("settings.set", ctx, INPUTS["settings.set"]);
  if (cap === "settings.reset_space") await run("settings.set_space", ctx, INPUTS["settings.set_space"]);
  h.events.length = 0;
  return { h, ctx };
}

test("a real handler exists for exactly the capabilities the registry declares for settings", () => {
  assert.equal(caps.length, 14);
  assert.deepEqual(Object.keys(handlers).sort(), caps.map((c) => c.name).sort());
});

for (const cap of caps) {
  const name = `${cap.name}@${cap.v}`;
  test(`${name}: real handler answers with a valid output and exactly the declared events`, async () => {
    assert.ok(cap.examples.length >= 1);
    const input = INPUTS[cap.name] ?? cap.examples[0]!.input;
    assert.deepEqual(validate(cap.input, input, "", defs), [], "input is valid");
    const { h, ctx } = await worldFor(cap.name);
    const out = await run(cap.name, ctx, input);
    assert.deepEqual(validate(cap.output, out, "", defs), [], "output");
    assert.deepEqual([...new Set(h.events.map((e) => e.name))].sort(), [...cap.emits].sort());
    for (const e of h.events) {
      assert.ok(cap.emits.includes(e.name), `${e.name} is declared in emits of ${cap.name}`);
      const schema = eventSchemas.get(e.name);
      assert.ok(schema, `${e.name} has a schema`);
      assert.deepEqual(validate(schema, e.payload, "", defs), [], `${e.name} payload`);
    }
  });
}
