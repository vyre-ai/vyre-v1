// Turn engine rows and ports (ARCH 6.1, 6.2, 6.5). Held in memory here behind store interfaces; module engine persists the same columns.
// The session types mirror ARCH 6.6 (agent/src/driver.ts is lead-owned and not on main yet); when it lands, adapt `OpenSession` to it in one place.
import type { RouteMention, RouteReason } from "../../../lib/route.ts";

export type ThreadKind = "chat" | "channel" | "thread" | "ask" | "run" | "helper" | "console";
export type AgentMode = "lead" | "listen";
export type QueueKind = "message" | "interrupt" | "wake" | "handoff";
export type QueueState = "queued" | "running" | "done" | "consumed" | "cancelled";
export type TurnState = "running" | "completed" | "failed" | "cancelled";
export type AccountReason = "starter" | "steerer";
export type Placement = "host" | "device";

export interface Author { kind: "person" | "agent"; id: string }

export interface EngineAgent {
  id: string;
  /** Display name for the "will reply" line. Falls back to the id. */
  name?: string;
  mode: AgentMode;
  /** Role line from agent.toml. Goes into the lead's context for listeners; never a reason to run inference. */
  role?: string;
  model?: string;
  accountRef?: string;
  /** "Watches this channel": acts without an @mention, logged as a routine. */
  watching?: boolean;
}

export interface OpenThread {
  id: string;
  kind: ThreadKind;
  /** The person who started the thread. Background wake-ups run on their account. */
  starter: string;
  agents: EngineAgent[];
}

export interface IncomingMessage {
  threadId: string;
  author: Author;
  mentions?: readonly RouteMention[];
  /** Agent-to-agent hops since the last person message. Persons reset it to 0. */
  depth?: number;
  body?: string;
}

export interface StoredMessage {
  id: string;
  threadId: string;
  threadSeq: number;
  author: Author;
  mentions: RouteMention[];
  depth: number;
  body: string;
}

export interface QueueItem {
  threadId: string;
  qseq: number;
  kind: QueueKind;
  messageId: string | null;
  agentId: string;
  /** Principal whose act put this row in the queue. */
  from: string;
  priority: number;
  state: QueueState;
  enqueuedAt: number;
  routine: boolean;
  /** Arrived while a turn of the same agent was running: eligible for injection at the next step boundary. */
  steer: boolean;
}

export interface TurnRow {
  id: string;
  threadId: string;
  agentId: string;
  /** Who pays: the starter, or the person whose steering message caused this turn. */
  asker: string;
  payerReason: AccountReason;
  model: string | null;
  state: TurnState;
  traceId: string;
  qseq: number;
  kind: QueueKind;
  routine: boolean;
  startedAt: number;
  endedAt: number | null;
  tokensIn: number;
  tokensOut: number;
  error: { code: string; message: string } | null;
  /** Receive of the triggering message to first text, minus the provider's own latency. The send budget row. */
  firstTokenOverheadMs: number | null;
  injected: number;
}

export interface SpendRow { agentId: string; turnId: string; payer: string; tokensIn: number; tokensOut: number }

export type EngineEvent =
  | { type: "message.received"; threadId: string; messageId: string; threadSeq: number; authorId: string }
  | { type: "turn.queued"; threadId: string; qseq: number; agentId: string; kind: QueueKind; priority: number; routine: boolean; steer: boolean }
  | { type: "turn.started"; threadId: string; turnId: string; agentId: string; qseq: number; asker: string }
  | { type: "turn.block"; threadId: string; turnId: string; idx: number; kind: string }
  | { type: "turn.waiting"; threadId: string; reason: "hop_limit"; messageId: string }
  | { type: "turn.completed"; threadId: string; turnId: string; agentId: string }
  | { type: "turn.failed"; threadId: string; turnId: string; agentId: string; code: string }
  | { type: "turn.cancelled"; threadId: string; turnId: string; agentId: string }
  | { type: "agent.handoff"; threadId: string; to: Placement }
  | { type: "queue.consumed"; threadId: string; qseq: number; messageId: string | null };

/** What an engine session streams back for one send (ARCH 6.6 DriverEvent). */
export type DriverEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "block"; kind: string; payload?: unknown }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "done"; mentions?: readonly RouteMention[] }
  | { type: "error"; code: string; message: string };

export interface ToolResult { ok: boolean; content: unknown }

export interface TurnInput {
  threadId: string;
  turnId: string;
  agent: EngineAgent;
  trigger: StoredMessage | null;
  /** Transcript window, oldest first. */
  history: readonly StoredMessage[];
  /** Listening agents, shown to the lead as context ("Docs is listening"). They run no inference. */
  listeners: readonly { id: string; role?: string }[];
  asker: string;
}

export interface EngineSession {
  send(input: TurnInput): AsyncIterable<DriverEvent>;
  sendToolResult(callId: string, result: ToolResult): void;
  /** Steering: a queued message injected between steps. */
  inject(msg: StoredMessage): void;
  cancel(): Promise<void>;
  close(): Promise<void>;
  readonly warm: boolean;
  /** Latency the provider itself injected before the first event (fake providers); real drivers omit it. */
  readonly providerLatencyMs?: number;
}

export interface SessionSpec { threadId: string; agent: EngineAgent; asker: string }
export type OpenSession = (spec: SessionSpec) => Promise<EngineSession>;

export interface ReceiveResult { responders: string[]; reason: RouteReason; qseqs: number[]; messageId: string }
export interface PreviewResult { responders: string[]; reason: RouteReason; listeners: string[]; line: string }
