// The block definitions of the frozen contract, as the server reads them: generated/registry.json `blocks` and `$defs`. The host passes the same two values from its loaded registry; this reader is for
// tests and tools that run without a host.
import { readFileSync } from "node:fs";
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";
import type { BlockDef } from "./types.ts";

export interface BlockRegistry { defs: BlockDef[]; schemas: Record<string, JsonSchema> }

export function loadBlockRegistry(file = new URL("../../../generated/registry.json", import.meta.url)): BlockRegistry {
  const reg = JSON.parse(readFileSync(file, "utf8")) as { blocks: BlockDef[]; $defs: Record<string, JsonSchema> };
  return { defs: reg.blocks, schemas: reg.$defs };
}
