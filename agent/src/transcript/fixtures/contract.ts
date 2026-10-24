// Checks against the frozen contract for the transcript tests: the schema of a native block's data and of an event's payload, read from generated/registry.json (as agent/src/tools/harness.ts does).
import { readFileSync } from "node:fs";
import { validate } from "../../../../packages/contracts/src/jsonschema.ts";
import type { Defs } from "../../../../packages/contracts/src/jsonschema.ts";
import type { JsonSchema } from "../../../../packages/contracts/src/types.ts";

interface Registry { $defs: Defs; blocks: Array<{ type: string; data: JsonSchema }>; events: Array<{ name: string; payload: JsonSchema }> }

let cached: Registry | null = null;
const registry = (): Registry => {
  cached ??= JSON.parse(readFileSync(new URL("../../../../generated/registry.json", import.meta.url), "utf8")) as Registry;
  return cached;
};

export function blockErrors(type: string, data: unknown): string[] {
  const r = registry();
  const def = r.blocks.find((b) => b.type === type);
  return def ? validate(def.data, data, "", r.$defs) : [`block ${type} is not in the registry`];
}

export function eventErrors(name: string, payload: unknown): string[] {
  const r = registry();
  const def = r.events.find((e) => e.name === name);
  return def ? validate(def.payload, payload, "", r.$defs) : [`event ${name} is not in the registry`];
}
