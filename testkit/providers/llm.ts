// Scripted LLM stream (ARCH 10.1). Latency is injected before the first event, which is what
// the send budget measures: first token = provider latency + overhead. The same script answers
// an HTTP POST to the provider hosts the engine drivers call.
import type { Clock } from "./clock.ts";
import { wallClock } from "./clock.ts";
import { jsonResponse, recordingFetch, type FetchLike, type SeenCall } from "./replay.ts";

export type LlmEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "done" }
  | { type: "error"; message: string };

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmTurn {
  model?: string;
  messages: LlmMessage[];
}

export interface LlmOptions {
  script?: LlmEvent[] | ((turn: LlmTurn) => LlmEvent[]);
  latencyMs?: number;
  clock?: Clock;
}

export interface LlmProvider {
  readonly name: "llm";
  readonly latencyMs: number;
  readonly calls: SeenCall[];
  readonly fetch: FetchLike;
  stream(turn: LlmTurn): AsyncIterable<LlmEvent>;
}

export function fakeLlm(opts: LlmOptions = {}): LlmProvider {
  const script = opts.script ?? [{ type: "done" }];
  const latencyMs = opts.latencyMs ?? 0;
  const clock = opts.clock ?? wallClock;
  const calls: SeenCall[] = [];
  const resolve = (turn: LlmTurn): LlmEvent[] => (typeof script === "function" ? script(turn) : script.slice());

  async function* stream(turn: LlmTurn): AsyncGenerator<LlmEvent> {
    if (latencyMs > 0) await clock.sleep(latencyMs);
    for (const ev of resolve(turn)) yield ev;
  }

  const fetch = recordingFetch(async (url, init) => {
    if (latencyMs > 0) await clock.sleep(latencyMs);
    const events = resolve(turnFrom(init?.body));
    const text = events.flatMap((e) => (e.type === "text" ? [e.text] : [])).join("");
    const path = safePath(url);
    if (path.endsWith("/chat/completions")) {
      return jsonResponse(200, {
        id: "chatcmpl_fake",
        choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      });
    }
    return jsonResponse(200, {
      id: "msg_fake",
      type: "message",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
    });
  }, calls);

  return { name: "llm", latencyMs, calls, fetch, stream };
}

function turnFrom(body: string | undefined): LlmTurn {
  if (!body) return { messages: [] };
  try {
    const parsed = JSON.parse(body) as { model?: unknown; messages?: unknown };
    const messages = Array.isArray(parsed.messages) ? parsed.messages.filter(isMessage) : [];
    return typeof parsed.model === "string" ? { model: parsed.model, messages } : { messages };
  } catch {
    return { messages: [] };
  }
}

function isMessage(v: unknown): v is LlmMessage {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (o.role === "system" || o.role === "user" || o.role === "assistant") && typeof o.content === "string";
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
