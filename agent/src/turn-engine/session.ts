// Structural port of EngineSession in agent/src/driver.ts (ARCH 6.6).
// That file is lead-owned and frozen. A real driver session plugs in here with no adapter:
// send, sendToolResult, inject and cancel are the same methods.
// API sessions run the tool loop in this process. CLI sessions take inject on their stdin protocol.
// latencyMs is the delay the session itself injects before the first event of a model call.
// The send budget subtracts it, so turn.first_token_overhead is only our time.

export interface TurnMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface TurnInput {
  agentId: string;
  model: string;
  messages: TurnMessage[];
  tools: { name: string }[];
}

export interface UserMessage {
  messageId: string;
  role: "user";
  content: string;
  authorId: string;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export type DriverEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "block"; blockType: string; text: string | null }
  | { type: "usage"; inputTokens: number; outputTokens: number; costMicros?: number }
  | { type: "done" }
  | { type: "error"; message: string; code?: string };

export interface TurnSession {
  send(input: TurnInput): AsyncIterable<DriverEvent>;
  sendToolResult?(callId: string, result: ToolResult): void;
  inject(msg: UserMessage): void;
  cancel(): Promise<void>;
  readonly driverId?: string;
  readonly latencyMs?: number;
  readonly warm?: boolean;
}
