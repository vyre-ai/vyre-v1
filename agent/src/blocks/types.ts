// Native blocks on the server side (ARCH 6.8, spec "native blocks"): what an agent turn attaches to a message or a tool result. The shapes mirror the client's registry (ui/src/blocks) and the frozen
// contract (generated/registry.json `blocks`); nothing here is hand-written per type, the definitions are read from the contract.
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";

export type BlockState = "live" | "done" | "waiting" | "error";

export interface Block<T = unknown> {
  type: string;
  v: number;
  id: string;
  /** Validated against the type's data schema when the block is made. */
  data: T;
  state?: BlockState;
  traceId: string;
}

/** The slice of a BlockTypeDef the server needs. */
export interface BlockDef {
  type: string;
  v: number;
  module: string;
  data: JsonSchema;
  /** Text template for CLI, mail and phone notifications: `{{field}}`, `{{a.b}}`, `{{list.length}}`. */
  fallback: string;
  actions?: ReadonlyArray<{ key: string; label: string; cap: string; input: Readonly<Record<string, string>> }>;
  opens?: { tab: string; input: Readonly<Record<string, string>> };
  /** question and plan: the turn parks until chat.answer_block is called. */
  waitsForAnswer?: boolean;
}

export interface EmitOptions {
  traceId: string;
  /** Default: waiting for blocks that wait for an answer, live for streaming blocks, done for the rest. */
  state?: BlockState;
  /** The version to emit. Default: the newest the contract has. */
  v?: number;
  /** A block the caller already named (the device's own id for an offline queue). */
  id?: string;
}

/** An ephemeral frame for a streaming block (terminal, deploy, screenshot): the live connection carries it, the final state is persisted as the turn's block. */
export type PatchOp =
  | { op: "set"; path: string; value: unknown }
  | { op: "append"; path: string; value: string };
export interface BlockPatch { id: string; ops: PatchOp[] }
