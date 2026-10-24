// Turn engine rows (ARCH 6.1, 6.2, 6.5). In memory here; module engine persists the same columns.
import type { RouteMention, RouteReason } from "../../../lib/route.ts";

export type ThreadKind = "chat" | "channel" | "thread" | "ask" | "run" | "helper" | "console";
export type AgentMode = "lead" | "listen";
export type QueueKind = "message" | "interrupt" | "wake" | "handoff";
export type QueueState = "queued" | "running" | "done" | "consumed" | "cancelled";
export type TurnState = "running" | "completed" | "failed" | "cancelled";
export type AccountReason = "starter" | "steerer" | "step_key" | "backup_key" | "none";
export type Placement = "host" | "device";
export type AuthorKind = "person" | "agent";

export interface EngineAuthor {
  kind: AuthorKind;
  id: string;
}

export interface EngineAgent {
  id: string;
  mode: AgentMode;
  name?: string;
  /** Role line from agent.toml. Included in the lead's context, never a reason to run inference. */
  role?: string;
  model?: string;
  provider?: string;
  accountRef?: string;
  /** "Watches this channel": act without an @mention, logged as a routine. */
  watching?: boolean;
}

export interface OpenThread {
  id: string;
  kind: ThreadKind;
  starter: string;
  starterAccountRef?: string;
  where?: Placement;
  agents: EngineAgent[];
}

export interface StoredThread {
  id: string;
  kind: ThreadKind;
  starter: string;
  starterAccountRef: string | null;
  where: Placement;
  agents: EngineAgent[];
}

export interface IncomingMessage {
  threadId: string;
  id?: string;
  threadSeq?: number;
  author: EngineAuthor;
  mentions?: readonly RouteMention[];
  /** Agent-to-agent hops since the last person message. Persons reset it to 0. */
  depth?: number;
  body?: string;
  /** Vault handle for a steerer. Never a secret value. */
  accountRef?: string;
  kind?: QueueKind;
  /** Wake and handoff name the agent. Interrupt targets the running agent when there is one. */
  agentId?: string;
  priority?: number;
}

export interface StoredMessage {
  id: string;
  threadId: string;
  threadSeq: number;
  author: EngineAuthor;
  mentions: RouteMention[];
  depth: number;
  body: string;
  accountRef: string | null;
}

export interface AccountChoice {
  accountRef: string | null;
  payer: string;
  reason: AccountReason;
}

export interface QueueItem {
  threadId: string;
  qseq: number;
  threadSeq: number;
  kind: QueueKind;
  messageId: string | null;
  agentId: string;
  from: string;
  priority: number;
  state: QueueState;
  enqueuedAt: number;
  routine: boolean;
  /** True when the row arrived while a turn on this thread was already running. */
  steer: boolean;
  account: AccountChoice;
}

export interface TurnBlock {
  idx: number;
  kind: string;
  text: string | null;
}

export interface TurnRow {
  id: string;
  threadId: string;
  agentId: string;
  asker: string;
  accountRef: string | null;
  payerReason: AccountReason;
  engine: string;
  model: string;
  state: TurnState;
  traceId: string;
  qseq: number;
  kind: QueueKind;
  routine: boolean;
  messageId: string | null;
  startedAt: number;
  endedAt: number | null;
  tokensIn: number;
  tokensOut: number;
  costMicros: number;
  error: { code: string; message: string } | null;
  /** Wall time from the send call to the first text or thinking event, minus the session's injected provider latency. */
  firstTokenOverheadMs: number | null;
  blocks: TurnBlock[];
}

export interface SpendRow {
  agentId: string;
  turnId: string;
  payer: string;
  tokensIn: number;
  tokensOut: number;
  costMicros: number;
}

export type LogEvent =
  | { type: "message.received"; threadId: string; messageId: string; threadSeq: number; authorId: string }
  | { type: "turn.queued"; threadId: string; qseq: number; agentId: string; kind: QueueKind; messageId: string | null; priority: number; routine: boolean }
  | { type: "turn.started"; threadId: string; turnId: string; agentId: string; qseq: number; accountRef: string | null; payerReason: AccountReason; asker: string }
  | { type: "turn.block"; threadId: string; turnId: string; idx: number; kind: string }
  | { type: "turn.completed"; threadId: string; turnId: string; agentId: string }
  | { type: "turn.failed"; threadId: string; turnId: string; agentId: string; code: string }
  | { type: "turn.cancelled"; threadId: string; turnId: string; agentId: string }
  | { type: "agent.limit_hit"; threadId: string; turnId: string; agentId: string; limit: "run" | "day" | "month" | "turns" | "time" }
  | { type: "agent.handoff"; threadId: string; agentId: string; to: Placement }
  | { type: "queue.consumed"; threadId: string; qseq: number; messageId: string | null };

export interface ReceiveResult {
  responders: string[];
  reason: RouteReason;
  qseqs: number[];
}

export interface PreviewResult {
  responders: string[];
  reason: RouteReason;
  listeners: string[];
  line: string;
}
