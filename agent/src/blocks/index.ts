// @vyre/agent blocks: the server side of the native block contract (ARCH 6.8).
export { STREAMING_TYPES, createBlocks } from "./emit.ts";
export type { Blocks, BlocksDeps } from "./emit.ts";
export { fallbackText, fillTemplate, genericLine } from "./fallback.ts";
export { blockHelpers } from "./named.ts";
export type { BlockHelpers } from "./named.ts";
export { loadBlockRegistry } from "./registry.ts";
export type { BlockRegistry } from "./registry.ts";
export type { Block, BlockDef, BlockPatch, BlockState, EmitOptions, PatchOp } from "./types.ts";
