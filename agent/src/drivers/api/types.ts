// API drivers (ARCH 6.6, spec 4.14): our own tool loop over each provider's streaming HTTP API. The shapes here are provider neutral; every provider file maps them to its wire format.
// Nothing in this folder holds a key. An account is named by its Vault handle and the Authorizer port returns the auth headers at the HTTP layer (ARCH 6.4).
import type { DriverEvent } from "../../turn-engine/types.ts";

export type ProviderId = "anthropic" | "openai" | "openrouter" | "google" | "xai";
export const PROVIDER_IDS: readonly ProviderId[] = ["anthropic", "openai", "openrouter", "google", "xai"];

/** A tool as the model sees it. The list is sorted by name before it is sent so the cached prefix never changes by accident. */
export interface ApiTool { name: string; description: string; inputSchema: unknown }

/** One block of the system prompt. Stable blocks (guide, VYRE.md, AGENT.md, MAP.md) carry the cache marker; volatile ones (pointer block, clock) come after it. */
export interface SystemBlock { text: string; stable: boolean }

export interface ToolCall { id: string; name: string; input: unknown }

/** The conversation a provider call is built from. Rebuilt from the thread on every send; the only state kept between sends is the connection. */
export type Msg =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; calls: ToolCall[] }
  | { role: "tool"; callId: string; name: string; content: string; ok: boolean };

export interface CallRequest {
  model: string;
  system: readonly SystemBlock[];
  tools: readonly ApiTool[];
  messages: readonly Msg[];
  maxOutputTokens: number;
  /** Hash of the stable system blocks and the tool list (prefix.ts). */
  prefixHash: string;
}

export interface WireRequest {
  /** Path (and query) under the base address. */
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface Usage { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }

/** What a decoder yields for one server-sent event. */
export type Decoded =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "usage"; usage: Partial<Usage> }
  | { type: "stop"; reason: "end" | "tool_use" | "length" | "filtered" | "other" }
  | { type: "error"; status: number; code?: string; message: string };

export interface SseEvent { event: string; data: string }

/** One decoder per call: it may keep state (partial tool-call arguments), never a buffer of text. */
export interface StreamDecoder {
  push(ev: SseEvent): Decoded[];
  /** The stream ended: whatever is still open is closed. */
  end(): Decoded[];
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly defaultBase: string;
  /** The model name the provider's own API takes ("anthropic/claude-x" for the Anthropic driver is "claude-x"). */
  modelName(model: string): string;
  /** Default output cap when the agent sets none. */
  readonly defaultMaxOutput: number;
  /** True when the provider's input token count already includes cached tokens (OpenAI style). Anthropic reports them apart, so the session adds them. */
  readonly inputIncludesCache: boolean;
  request(req: CallRequest): WireRequest;
  decoder(): StreamDecoder;
  modelsRequest(): { path: string; headers: Record<string, string> };
  parseModels(json: unknown): ModelInfo[];
}

export interface ModelInfo { id: string; label?: string }

/** An account as a driver sees it: the Vault handle, and the address when the account names its own (OpenAI-compatible endpoints). */
export interface AccountRef { ref: string; base?: string }

/** Auth headers for one account, built at the HTTP layer from the Vault. The key never reaches module code. */
export type Authorizer = (account: AccountRef, provider: ProviderId) => Promise<Record<string, string>>;

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<FetchResponse>;
export interface FetchResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: AsyncIterable<Uint8Array> | null;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export interface Clock { now(): number; sleep(ms: number, signal?: AbortSignal): Promise<void> }

export type { DriverEvent };
