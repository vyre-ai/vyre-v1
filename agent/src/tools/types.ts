// Agent tool surface (ARCH 6.7, spec "Vyre is the agent's native environment"). A tool is one capability (or an agentTools wrapper of one) as the model sees it.
import type { Level } from "../../../packages/contracts/src/types.ts";

export type { Level };
export type Effects = "read" | "write" | "outward";
export type PlanModeRule = "allowed" | "blocked";
export type LocalKind = "terminal" | "chrome" | "screen" | "files" | "none";

export const LEVEL_RANK: Readonly<Record<Level, number>> = Object.freeze({ view: 1, use: 2, edit: 3, manage: 4 });

export interface ToolDef {
  name: string;
  cap: string;
  v: number;
  toolset: string;
  summary: string;
  inputSchema: unknown;
  effects: Effects;
  planMode: PlanModeRule;
  /** Level the capability needs on its resource. */
  level: Level;
  deferred: boolean;
  blocks: string[];
  /** Executes where the target lives (agent computer, device). Only these are governed by Ask, Allow and Auto. */
  local: LocalKind;
  /** The capability has a Gate rule (outward or risky acts). */
  gated: boolean;
}

/** The slices of generated/registry.json and generated/mcp-tools.json this module reads. */
export interface RegistryCapRow { name: string; v: number; level: Level; effects: Effects; gate?: unknown }
export interface McpToolRow {
  name: string; cap: string | null; v: number; toolset: string; description: string; inputSchema: unknown;
  effects: Effects; planMode: PlanModeRule; deferred: boolean; blocks?: readonly string[]; local?: string;
}
export interface AgentToolRow { name: string; local?: string }

export interface Catalog {
  all: readonly ToolDef[];
  byName(name: string): ToolDef | undefined;
}

export type Refusal = "plan_mode" | "ask_level" | "agent_denied" | "engineer" | "no_access";

export interface ThreadFacts {
  threadId: string;
  kind: "chat" | "channel" | "thread" | "ask" | "run" | "helper" | "console";
  /** Ask panes: the object being looked at. */
  scope?: { type: string; id: string };
  planMode: boolean;
}

export interface AgentRules {
  /** Tool names or toolset names. Empty or missing = everything the asker may do. */
  allow?: readonly string[];
  /** Tool names or toolset names. Deny wins over allow. */
  deny?: readonly string[];
}

export interface ToolCtx {
  space: string;
  agentId: string;
  /** Whose access the call is intersected with: the asker, or for a routine its setter. */
  asker: string;
  thread: ThreadFacts;
  rules?: AgentRules;
  /** AI provider of the running engine, for label vs provider. */
  provider?: string;
  turnId?: string;
  runId?: string;
  trace?: { traceId: string; spanId: string; parent?: string };
}

export interface ToolResult { ok: boolean; content: unknown }

export interface ToolSet {
  /** Asker's level on the Ask scope; "manage" outside Ask threads (the invoke pipeline still intersects); null = no access to the scope. */
  level: Level | null;
  /** The default listed set for this turn. */
  listed: ToolDef[];
  /** Deferred tools reachable through tool_search, already filtered the same way. */
  searchable: ToolDef[];
}
