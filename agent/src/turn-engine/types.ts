// Turn engine rows and ports (ARCH 6.1, 6.2, 6.5). Held in memory here behind store interfaces; module engine persists the same columns.
// The session types mirror ARCH 6.6 (agent/src/driver.ts is lead-owned and not on main yet); when it lands, adapt `OpenSession` to it in one place.
import type { RouteMention, RouteReason } from "../../../lib/route.ts";
import type { AccountKind, ResolveReason } from "../accounts/types.ts";
import type { TurnContext } from "./context.ts";

export type ThreadKind = "chat" | "channel" | "thread" | "ask" | "run" | "helper" | "console";
export type AgentMode = "lead" | "listen";
/** How much the agents of a chat may do alone (threads.set_mode): "ask" asks before it changes or sends anything, "auto" acts alone, "plan" only reads and plans. Anything that leaves Vyre is held for a yes in every mode. */
export type ChatMode = "ask" | "auto" | "plan";
export type Effort = "low" | "medium" | "high" | "max";
export type QueueKind = "message" | "interrupt" | "wake" | "handoff";
export type QueueState = "queued" | "running" | "done" | "consumed" | "cancelled";
export type TurnState = "running" | "waiting" | "completed" | "failed" | "cancelled";
export type AccountReason = "starter" | "steerer";
export type Placement = "host" | "device";

export interface Author { kind: "person" | "agent"; id: string }

export interface EngineAgent {
  id: string;
  /** The agent that works a task, in the thread of that task with several agents: it answers what a person writes there without an @. An agent's own line (a reviewer's hand-off) never wakes it. */
  taskLead?: boolean;
  /** Display name for the "will reply" line. Falls back to the id. */
  name?: string;
  mode: AgentMode;
  /** Role line from agent.toml. Goes into the lead's context for listeners; never a reason to run inference. */
  role?: string;
  model?: string;
  /** How hard the model thinks for this agent in this chat; each driver maps it onto its own setting. */
  effort?: Effort;
  accountRef?: string;
  /** "Watches this channel": acts without an @mention, logged as a routine. */
  watching?: boolean;
  /** It runs outside Vyre: no turn runs for it here. A message for it goes to its queue instead (agent.outside_asked). */
  outside?: boolean;
  /** Listening: never answers, not even tagged. Only a poke makes it speak. */
  quiet?: boolean;
  /** When it answers a message nobody tagged it in (lib/route.ts mayAnswerUntagged). */
  when?: "always" | "topics" | "hours"; topics?: string; hoursFrom?: string; hoursTo?: string;
  /** One line the turn is told about how long the reply is: "Keep replies short." or "Give full detail." Per agent, per chat. */
  style?: "short" | "full";
}

export interface OpenThread {
  id: string;
  /** A thread on the person's own task, note or goal (not a reply thread in a channel). */
  personal?: boolean;
  /** The people in the chat, when the host knows them: a person mentioned who is not among them is only talked about. */
  people?: string[];
  kind: ThreadKind;
  /** The person who started the thread. Background wake-ups run on their account. */
  starter: string;
  agents: EngineAgent[];
}

export interface IncomingMessage {
  threadId: string;
  author: Author;
  /** The person whose message this replies to: a reply to someone else's message is for them, not the lead. */
  replyToPerson?: string | undefined;
  /** A Job's own line, verified by chat.post, and the person the Job works for: it wakes the lead even when the lead wrote it, and that person pays for the turn. The author stays the agent: a Job's words never count as a person's. */
  job?: string | undefined;
  /**
   * An agent's message: the person it speaks for, the asker of the turn that wrote it (or chat.post's actingFor). A turn it sets off runs for that person, so a chain of @mentions keeps the
   * person whose message started it. An agent's message without one has no person behind it: a turn it would set off stops with no_asker instead of running as the chat's starter.
   */
  asker?: string | undefined;
  mentions?: readonly RouteMention[];
  /** Agent-to-agent hops since the last person message. Persons reset it to 0. */
  depth?: number;
  body?: string;
  /** The people in the chat as the host read them for this message, so a mention of anyone else is a reference. */
  people?: readonly string[];
  /** A person poked this agent: it answers now, Listening or not, from the last 12 messages, and the reply says who poked it. */
  poke?: { agentId: string; by: string } | undefined;
  /** Minutes since midnight where the speaker is, for agents set to answer only inside hours. */
  minutes?: number | undefined;
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
  /** The turn this row started has called a tool: it may have acted on the world, so it is never run again without a person saying so. */
  touched?: boolean;
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
  /** What the reply's Details shows (chat.reply_details): filled as the turn runs, recorded with it by engine.turn.record. Absent on a row made by older code. */
  info?: TurnInfo;
}

/** A tool call of one turn, as the engine saw it: when it started and ended, whether it worked, and whether it was held for a person's yes. */
export interface ToolTrace { id: string; name: string; detail?: string; startedAt: number; endedAt?: number; ok?: boolean; held?: string }
/** The turn left one account for another (or tried the same one again when the vendor was busy): from and to are account refs. */
export interface TurnSwitch { at: number; from: string; to: string; why: string }
/** The parts of a turn the turn record keeps for its Details. A count that is absent was not reported by the provider. */
export interface TurnInfo {
  effort?: Effort;
  /** The account that paid at the end (after any switch). */
  account?: { ref: string; driver: string; provider: string; kind: AccountKind; shared?: boolean; spaceKey?: boolean };
  /** Who paid and why, in a plain line (accounts/paid.ts). */
  paid?: string;
  /** The first word or thought, epoch ms. */
  firstTokenAt?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  /** What the turn's last request sent, fresh and cached: the size of the chat as the model last saw it (the turn's token total adds every request of the turn together). */
  contextTokens?: number;
  /** The provider's own dollar figure, summed over the turn's calls, when every call reported one. */
  costUsd?: number;
  tools: ToolTrace[];
  switches: TurnSwitch[];
}

export interface SpendRow { agentId: string; turnId: string; payer: string; tokensIn: number; tokensOut: number }

export type EngineEvent =
  | { type: "message.received"; threadId: string; messageId: string; threadSeq: number; authorId: string }
  /** A message is for an outside agent. Nothing runs here; it picks the message up when it next asks. */
  | { type: "agent.outside_asked"; threadId: string; messageId: string; agentId: string; asker: string; body: string }
  | { type: "turn.queued"; threadId: string; qseq: number; agentId: string; kind: QueueKind; priority: number; routine: boolean; steer: boolean }
  | { type: "turn.started"; threadId: string; turnId: string; agentId: string; qseq: number; asker: string }
  | { type: "turn.block"; threadId: string; turnId: string; idx: number; kind: string }
  | { type: "turn.waiting"; threadId: string; reason: "hop_limit"; messageId: string }
  /** A tool call was held at the Gate (ARCH 6.7): the turn parks on the approval task and a wake continues it once the task is answered. */
  | { type: "turn.waiting"; threadId: string; reason: "approval"; turnId: string; agentId: string; taskId: string; runId?: string }
  /** A parked turn is over: its wake started as a turn of its own. */
  | { type: "turn.resumed"; threadId: string; turnId: string; agentId: string }
  | { type: "turn.completed"; threadId: string; turnId: string; agentId: string }
  | { type: "turn.failed"; threadId: string; turnId: string; agentId: string; code: string; /** a turn a dead host left (code host_lost): its queue row and whom it ran for */ qseq?: number; asker?: string; /** what the engine knows of the failure, for the log only: never stored in an event, never shown to the person, scrubbed by the bridge before it is written */ message?: string }
  | { type: "turn.cancelled"; threadId: string; turnId: string; agentId: string; /** why it was stopped: interrupt, stop, limit, left, moved, lease */ reason?: string }
  | { type: "agent.handoff"; threadId: string; to: Placement }
  | { type: "queue.consumed"; threadId: string; qseq: number; messageId: string | null };

/** What an engine session streams back for one send (ARCH 6.6 DriverEvent). */
export type DriverEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  /** The model finished a step that asked for tools and now waits for their results: the calls yielded since the last step are the whole batch. Only a driver with parallelTools says it. */
  | { type: "tool_wait" }
  | { type: "block"; kind: string; payload?: unknown }
  /**
   * inputTokens counts every input token, cache reads and writes included. The optional fields are present only when the provider reported them: cache reads and writes, reasoning tokens
   * (already inside outputTokens), and the provider's own price for the call in dollars (Claude Code's total_cost_usd, OpenRouter's usage.cost). Absent means not reported, never zero.
   */
  | { type: "usage"; inputTokens: number; outputTokens: number; model?: string; contextTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number; costUsd?: number }
  /** A subscription limit window as the engine reported it (percent used 0 to 100, reset time in epoch ms). Kept per account; shown only when reported. */
  | { type: "limits"; window: "session" | "week"; pct: number; resetsAt?: number }
  | { type: "done"; mentions?: readonly RouteMention[] }
  /** resetsAt: a limit refusal that said when the account or model is usable again (epoch ms). */
  | { type: "error"; code: string; message: string; resetsAt?: number };

export interface ToolResult { ok: boolean; content: unknown }

/** One line the memory module recalled for a message: a fact (or note title) with where it is kept and the link to the chat, task or record it came from. */
export interface RecallLine {
  title: string; fact?: string; trueSince?: number; path: string; sourceLink?: string;
  /** "quote" is the exact words of a past chat message or run step (title = where it was said); anything else is a fact or note. */
  kind?: "fact" | "quote";
  /** The source id: a fact id for a fact, a message id or <thread>#<index> for a quote. A model passes it to memory_quote or memory_forget. */
  ref?: string;
  /** Who said a quote, and when. */
  by?: string;
  at?: number;
  /** A quote cut for the prompt: the rest is memory_quote with its ref. */
  cut?: boolean;
}

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
  /** Set on the wake that continues a turn parked on a held tool call: the answer to that call. */
  resumed?: ResumedCall;
  /** What memory recalled for the message that caused this turn (memory.pointer, as the asker). Absent when nothing matched or memory is not available. */
  recall?: readonly RecallLine[];
  /** The ordered turn context (identity, where, skills, what the agent can do here, screen, time ...), built by the engine module as the asker; drivers render it (agent/src/turn-engine/context.ts). */
  context?: TurnContext;
  /**
   * Compact the engine's own context instead of answering (engine.compact): an engine with a compact of its own runs it, keeping what `keep` names, and reports a `compacted` block
   * ({ before?, after? } in tokens, as the engine said them). One without it answers engine.compact_unsupported; one with nothing to compact yet, engine.nothing_to_compact.
   */
  compact?: { keep: string };
  /** What the person asked to keep through every compaction of this chat ("Keep this every time"): an engine that shortens the conversation by itself puts it at the head of what stands for the dropped part. */
  keep?: string;
  /**
   * The same turn going on after the computer it started on went away (modules/engine/device-turns.ts): where it started, what it had already said, and the steps it had already taken (tool names,
   * in order). The engine continues from there and does not repeat a step that is done.
   */
  handover?: { from: string; said: string; steps: readonly string[] };
  /** A note from Vyre for this turn (a held call was answered: modules/engine/held-notes.ts). The engine's input only; never a chat message. */
  notice?: string;
}

export interface ResumedCall { taskId: string; callId: string; toolName: string; approved: boolean; result: ToolResult }

export interface EngineSession {
  send(input: TurnInput): AsyncIterable<DriverEvent>;
  sendToolResult(callId: string, result: ToolResult): void;
  /** Steering: a queued message injected between steps. */
  inject(msg: StoredMessage): void;
  cancel(): Promise<void>;
  close(): Promise<void>;
  readonly warm: boolean;
  /** The session yields every tool call of a step, then tool_wait, and takes each result by id in any order: the engine may run independent calls together. */
  readonly parallelTools?: boolean;
  /** Latency the provider itself injected before the first event (fake providers); real drivers omit it. */
  readonly providerLatencyMs?: number;
}

/**
 * The account a turn runs on, as engine.account.resolve answered it. `ref` is the Vault handle (never a value); the opener fetches the secret itself through Vault fill.
 * `itemId` is the Vault item behind the handle, so usage can be metered against it. `payer` is the person who pays.
 */
/** What a session can say about itself beyond running turns. */
export interface SessionModel { /** The model that really runs. */ readonly model?: string }
export interface ResolvedAccount { ref: string; driver: string; provider: string; kind: AccountKind; payer: string; reason: ResolveReason; itemId?: string;
  /** The account's name as its owner sees it (Details: Paid by). */
  name?: string;
  /** Which rule chose it (the Chat key, the chat's pick, an own-work account, a step's account, a Space account, a backup); absent for the asker's own. */
  via?: "thread" | "chat_key" | "work" | "step" | "space" | "backup" | "own";
  /** The account ahead of this one that had hit its monthly cap. */
  cappedFrom?: string;
  /** An account ahead of this one could not pay (signed out, failing, out of its limit): this is a fallback, not the person's first choice. */
  fellBack?: boolean;
  /** A key of the Space, not the person's own: `payer` is only whose turn it was. */
  shared?: boolean;
  /** The Space AI key everyone falls back to: the turn runs on one of the models it unlocks. */
  spaceKey?: boolean;
  /** No account serving the chat's model could pay: the turn runs on this account's default model (`to`, else the engine's default), and the chat says so (owner ruling 9). */
  modelFallback?: { from: string; to?: string };
  /** An OpenAI-compatible endpoint names its own address (custom, local); `keyless` is a local server with no key. */
  base?: string; keyless?: boolean }
export interface AccountQuery {
  threadId: string; agentId: string; askerId: string; stepKey?: string; /** Accounts that already failed this turn: the answer skips them and follows the agent's order. */ unavailable?: readonly string[];
  /** What caused the turn, so the right Space AI accounts may pay (owner ruling 9): a chat message, a wake-up, or an agent acting unasked (a watcher: agent work). Absent: a chat. */
  kind?: "chat" | "wake" | "agent_work";
  /** Why the last account was left: "overloaded" is the vendor being busy, not a limit, so it is not set aside to rest and the chat says it was busy. */
  why?: "overloaded";
}
/** A turn whose model the engine said is not available: who asked, on which account, and the engine's own words (Details only). */
export interface ModelQuery { threadId: string; agentId: string; askerId: string; account: ResolvedAccount; message: string }
export interface SessionSpec {
  threadId: string; agent: EngineAgent; asker: string; turnId: string; traceId: string; account?: ResolvedAccount;
  /** The chat's mode for this turn. Absent: the driver's older behaviour (a session of a step or a one-shot job has no chat mode). */
  mode?: ChatMode;
  /** "none": the session has no Vyre tools and no tools of its own (an automation's AI step answers in words and sends nothing). Absent: the agent's tools. */
  tools?: "none";
  /**
   * A one-shot model call (memory learning, upkeep): the agent's role is the whole system prompt, and nothing else goes with it. No tools, no MCP, no settings files, no CLAUDE.md or AGENTS.md,
   * no skills, no saved session. A CLI engine runs its leanest command (CommandOptions.lean); an API driver sends the role alone. Implies tools "none".
   */
  lean?: boolean;
  /** A one-shot for a person whose chats run on their own computer: its CLI engine process starts there, through the computer's link, never on the Space's server (modules/engine/node-turns.ts). */
  onDevice?: boolean;
}
export type OpenSession = (spec: SessionSpec) => Promise<EngineSession>;

export interface ReceiveResult {
  responders: string[]; reason: RouteReason; qseqs: number[]; messageId: string;
  /** An agent handed the chat to others with an @mention: who asked whom, for the chat's one-line chain ("Intake asked Docs"). */
  chain?: { from: string; to: string[] };
}
export interface PreviewResult { responders: string[]; reason: RouteReason; listeners: string[]; line: string }
