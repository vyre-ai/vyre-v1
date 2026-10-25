// Anthropic Messages API, streaming. The stable system blocks and the tool list end in a cache marker; tool calls are completed here from input_json_delta pieces so the session sees whole calls.
import { orderSystem, sortTools } from "./prefix.ts";
import type { CallRequest, Decoded, ModelInfo, ProviderAdapter, SseEvent, StreamDecoder, ToolCall, Usage, WireRequest } from "./types.ts";

const VERSION = "2023-06-01";

interface Block { type: string; text?: string; id?: string; name?: string; source?: unknown }

function wireMessages(req: CallRequest): unknown[] {
  const out: unknown[] = [];
  let pendingResults: unknown[] = [];
  const flushResults = (): void => {
    if (pendingResults.length > 0) out.push({ role: "user", content: pendingResults });
    pendingResults = [];
  };
  for (const m of req.messages) {
    if (m.role === "tool") {
      // All results of one assistant step travel in a single user message, as the API requires.
      pendingResults.push({ type: "tool_result", tool_use_id: m.callId, content: m.content, ...(m.ok ? {} : { is_error: true }) });
      continue;
    }
    flushResults();
    if (m.role === "user") out.push({ role: "user", content: [{ type: "text", text: m.text }] });
    else {
      const content: Block[] = [];
      if (m.text) content.push({ type: "text", text: m.text });
      for (const c of m.calls) content.push({ type: "tool_use", id: c.id, name: c.name, input: c.input } as Block);
      if (content.length === 0) content.push({ type: "text", text: "(no reply)" });
      out.push({ role: "assistant", content });
    }
  }
  flushResults();
  return out;
}

function request(req: CallRequest): WireRequest {
  const ordered = orderSystem(req.system);
  const lastStable = ordered.reduce((n, b, i) => (b.stable ? i : n), -1);
  const system = ordered.map((b, i) => ({ type: "text", text: b.text, ...(i === lastStable ? { cache_control: { type: "ephemeral" } } : {}) }));
  const tools = sortTools(req.tools).map((t, i, all) => ({
    name: t.name, description: t.description, input_schema: t.inputSchema ?? { type: "object", properties: {} },
    ...(i === all.length - 1 ? { cache_control: { type: "ephemeral" } } : {}),
  }));
  return {
    path: "/v1/messages",
    headers: { "content-type": "application/json", "anthropic-version": VERSION, accept: "text/event-stream" },
    body: {
      model: req.model, max_tokens: req.maxOutputTokens, stream: true,
      ...(system.length > 0 ? { system } : {}),
      ...(tools.length > 0 ? { tools } : {}),
      messages: wireMessages(req),
    },
  };
}

interface OpenBlock { kind: "text" | "thinking" | "tool"; id: string; name: string; json: string }

function decoder(): StreamDecoder {
  const open = new Map<number, OpenBlock>();
  let stopReason: Extract<Decoded, { type: "stop" }>["reason"] = "other";
  let sawStop = false;

  const usageOf = (u: Record<string, unknown> | undefined): Partial<Usage> => {
    const o: Partial<Usage> = {};
    if (!u) return o;
    if (typeof u["input_tokens"] === "number") o.inputTokens = u["input_tokens"];
    if (typeof u["output_tokens"] === "number") o.outputTokens = u["output_tokens"];
    if (typeof u["cache_read_input_tokens"] === "number") o.cacheReadTokens = u["cache_read_input_tokens"];
    if (typeof u["cache_creation_input_tokens"] === "number") o.cacheWriteTokens = u["cache_creation_input_tokens"];
    return o;
  };
  const closeBlock = (index: number): Decoded[] => {
    const b = open.get(index);
    open.delete(index);
    if (!b || b.kind !== "tool") return [];
    let input: unknown = {};
    if (b.json.trim() !== "") {
      try { input = JSON.parse(b.json); } catch { return [{ type: "error", status: 200, code: "provider.bad_response", message: `Tool call ${b.name} arrived with unreadable arguments.` }]; }
    }
    const call: ToolCall = { id: b.id, name: b.name, input };
    return [{ type: "tool_call", call }];
  };

  return {
    push(ev: SseEvent): Decoded[] {
      if (ev.event === "ping") return [];
      let j: Record<string, any>;
      try { j = JSON.parse(ev.data) as Record<string, any>; } catch { return []; }
      switch (j["type"]) {
        case "message_start": return [{ type: "usage", usage: usageOf(j["message"]?.usage) }];
        case "content_block_start": {
          const cb = j["content_block"] as Record<string, any> | undefined;
          const index = Number(j["index"]);
          if (!cb) return [];
          if (cb["type"] === "tool_use") open.set(index, { kind: "tool", id: String(cb["id"]), name: String(cb["name"]), json: "" });
          else open.set(index, { kind: cb["type"] === "thinking" ? "thinking" : "text", id: "", name: "", json: "" });
          // A block may carry its first text right in the start event.
          return typeof cb["text"] === "string" && cb["text"] !== "" ? [{ type: "text", text: cb["text"] }] : [];
        }
        case "content_block_delta": {
          const d = j["delta"] as Record<string, any> | undefined;
          if (!d) return [];
          if (d["type"] === "text_delta") return [{ type: "text", text: String(d["text"] ?? "") }];
          if (d["type"] === "thinking_delta") return [{ type: "thinking", text: String(d["thinking"] ?? "") }];
          if (d["type"] === "input_json_delta") {
            const b = open.get(Number(j["index"]));
            if (b) b.json += String(d["partial_json"] ?? "");
          }
          return [];
        }
        case "content_block_stop": return closeBlock(Number(j["index"]));
        case "message_delta": {
          const reason = j["delta"]?.stop_reason as string | null | undefined;
          if (reason) {
            sawStop = true;
            stopReason = reason === "tool_use" ? "tool_use" : reason === "max_tokens" ? "length" : reason === "refusal" ? "filtered" : reason === "end_turn" || reason === "stop_sequence" ? "end" : "other";
          }
          return [{ type: "usage", usage: usageOf(j["usage"]) }];
        }
        case "message_stop": return [{ type: "stop", reason: sawStop ? stopReason : "end" }];
        case "error": {
          const e = j["error"] as Record<string, any> | undefined;
          return [{ type: "error", status: 200, code: String(e?.["type"] ?? "error"), message: String(e?.["message"] ?? "The provider reported an error.") }];
        }
        default: return [];
      }
    },
    end(): Decoded[] {
      const out: Decoded[] = [];
      for (const index of [...open.keys()]) out.push(...closeBlock(index));
      return out;
    },
  };
}

export const anthropic: ProviderAdapter = {
  id: "anthropic",
  defaultBase: "https://api.anthropic.com",
  defaultMaxOutput: 16_384,
  inputIncludesCache: false,
  modelName: (m) => (m.startsWith("anthropic/") ? m.slice("anthropic/".length) : m),
  request,
  decoder,
  modelsRequest: () => ({ path: "/v1/models?limit=100", headers: { "anthropic-version": VERSION } }),
  parseModels(json): ModelInfo[] {
    const rows = (json as { data?: Array<{ id?: unknown; display_name?: unknown }> } | null)?.data ?? [];
    return rows.filter((r) => typeof r.id === "string").map((r) => ({ id: String(r.id), ...(typeof r.display_name === "string" ? { label: r.display_name } : {}) }));
  },
};
