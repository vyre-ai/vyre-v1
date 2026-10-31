// Chat Completions streaming: one adapter for OpenAI, OpenRouter and xAI (and, with a base address, OpenAI-compatible endpoints such as OpenCode Go or a local model).
import { orderSystem, sortTools } from "./prefix.ts";
import type { CallRequest, Decoded, ModelInfo, ProviderAdapter, ApiId, SseEvent, StreamDecoder, ToolCall, Usage, WireRequest } from "./types.ts";

export interface CompatOptions {
  id: ApiId;
  base: string;
  /** OpenAI wants max_completion_tokens (o-series and gpt-5 refuse max_tokens); the others take max_tokens. */
  tokenField: "max_completion_tokens" | "max_tokens";
  /** OpenAI: send the prefix hash as prompt_cache_key so a resumed chat lands on the machine that holds its prefix. */
  cacheKey: boolean;
  /** OpenRouter: ask for cost in the usage chunk, refuse training on the prompt, and mark the Anthropic prefix. */
  router: boolean;
  /** Keep only these model ids in the model list. */
  modelFilter?: RegExp;
  defaultMaxOutput: number;
  /** Where the model list is read when it is not `<base>/models`. */
  modelsUrl?: string;
}

function wireMessages(req: CallRequest, markPrefix: boolean): unknown[] {
  const ordered = orderSystem(req.system);
  const out: unknown[] = [];
  if (ordered.length > 0) {
    if (markPrefix) {
      const lastStable = ordered.reduce((n, b, i) => (b.stable ? i : n), -1);
      out.push({ role: "system", content: ordered.map((b, i) => ({ type: "text", text: b.text, ...(i === lastStable ? { cache_control: { type: "ephemeral" } } : {}) })) });
    } else out.push({ role: "system", content: ordered.map((b) => b.text).join("\n\n") });
  }
  for (const m of req.messages) {
    if (m.role === "user") out.push({ role: "user", content: m.text });
    else if (m.role === "tool") out.push({ role: "tool", tool_call_id: m.callId, content: m.content });
    else {
      out.push({
        role: "assistant",
        content: m.text === "" ? null : m.text,
        ...(m.calls.length > 0 ? { tool_calls: m.calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) } })) } : {}),
      });
    }
  }
  return out;
}

interface PartialCall { id: string; name: string; args: string }

function decoder(): StreamDecoder {
  const calls = new Map<number, PartialCall>();
  let flushed = false;
  const flush = (): Decoded[] => {
    if (flushed) return [];
    flushed = true;
    const out: Decoded[] = [];
    for (const index of [...calls.keys()].sort((a, b) => a - b)) {
      const c = calls.get(index);
      if (!c) continue;
      let input: unknown = {};
      if (c.args.trim() !== "") {
        try { input = JSON.parse(c.args); } catch { out.push({ type: "error", status: 200, code: "provider.bad_response", message: `Tool call ${c.name} arrived with unreadable arguments.` }); continue; }
      }
      const call: ToolCall = { id: c.id || `call_${index}`, name: c.name, input };
      out.push({ type: "tool_call", call });
    }
    calls.clear();
    return out;
  };
  return {
    push(ev: SseEvent): Decoded[] {
      const data = ev.data.trim();
      if (data === "[DONE]") return flush();
      let j: Record<string, any>;
      try { j = JSON.parse(data) as Record<string, any>; } catch { return []; }
      if (j["error"]) {
        const e = j["error"] as Record<string, any>;
        const status = typeof e["code"] === "number" ? e["code"] : 200;
        return [{ type: "error", status, code: typeof e["code"] === "string" ? e["code"] : String(e["type"] ?? "error"), message: String(e["message"] ?? "The provider reported an error.") }];
      }
      const out: Decoded[] = [];
      const choice = (j["choices"] as Array<Record<string, any>> | undefined)?.[0];
      const delta = choice?.["delta"] as Record<string, any> | undefined;
      if (delta) {
        const reasoning = delta["reasoning_content"] ?? delta["reasoning"];
        if (typeof reasoning === "string" && reasoning !== "") out.push({ type: "thinking", text: reasoning });
        if (typeof delta["content"] === "string" && delta["content"] !== "") out.push({ type: "text", text: delta["content"] });
        for (const t of (delta["tool_calls"] as Array<Record<string, any>> | undefined) ?? []) {
          const index = typeof t["index"] === "number" ? t["index"] : calls.size;
          const cur = calls.get(index) ?? { id: "", name: "", args: "" };
          if (typeof t["id"] === "string" && t["id"] !== "") cur.id = t["id"];
          const fn = t["function"] as Record<string, any> | undefined;
          if (typeof fn?.["name"] === "string") cur.name += fn["name"];
          if (typeof fn?.["arguments"] === "string") cur.args += fn["arguments"];
          calls.set(index, cur);
        }
      }
      const reason = choice?.["finish_reason"] as string | null | undefined;
      if (reason) {
        out.push(...flush());
        out.push({ type: "stop", reason: reason === "tool_calls" || reason === "function_call" ? "tool_use" : reason === "length" ? "length" : reason === "content_filter" ? "filtered" : reason === "stop" ? "end" : "other" });
      }
      const u = j["usage"] as Record<string, any> | undefined;
      if (u) {
        const usage: Partial<Usage> = {};
        if (typeof u["prompt_tokens"] === "number") usage.inputTokens = u["prompt_tokens"];
        if (typeof u["completion_tokens"] === "number") usage.outputTokens = u["completion_tokens"];
        const d = u["prompt_tokens_details"] as Record<string, any> | undefined;
        if (typeof d?.["cached_tokens"] === "number") usage.cacheReadTokens = d["cached_tokens"];
        if (typeof d?.["cache_write_tokens"] === "number") usage.cacheWriteTokens = d["cache_write_tokens"];
        out.push({ type: "usage", usage });
      }
      return out;
    },
    end: flush,
  };
}

export function openaiCompatible(o: CompatOptions): ProviderAdapter {
  return {
    id: o.id,
    defaultBase: o.base,
    defaultMaxOutput: o.defaultMaxOutput,
    inputIncludesCache: true,
    modelName: (m) => (m.startsWith(`${o.id}/`) ? m.slice(o.id.length + 1) : m),
    request(req: CallRequest): WireRequest {
      // Reasoning effort: OpenAI's own `reasoning_effort` for its reasoning models (o-series, gpt-5), OpenRouter's `reasoning.effort` for any routed model. Max is high: the highest both name.
      const level = req.effort === undefined ? undefined : req.effort === "max" ? "high" : req.effort;
      const reasoning = level === undefined ? {} : o.id === "openai" && /^(o\d|gpt-5)/.test(req.model) ? { reasoning_effort: level } : o.router ? { reasoning: { effort: level } } : {};
      const tools = sortTools(req.tools).map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema ?? { type: "object", properties: {} } } }));
      const mark = o.router && req.model.startsWith("anthropic/");
      return {
        path: "/chat/completions",
        headers: { "content-type": "application/json", accept: "text/event-stream", ...(o.router ? { "x-title": "Vyre" } : {}) },
        body: {
          model: req.model, stream: true, stream_options: { include_usage: true },
          [o.tokenField]: req.maxOutputTokens,
          ...(o.cacheKey ? { prompt_cache_key: req.prefixHash } : {}),
          ...(o.router ? { usage: { include: true }, provider: { data_collection: "deny" } } : {}),
          ...(tools.length > 0 ? { tools } : {}),
          ...reasoning,
          messages: wireMessages(req, mark),
        },
      };
    },
    decoder,
    modelsRequest: () => ({ path: "/models", headers: {}, ...(o.modelsUrl ? { url: o.modelsUrl } : {}) }),
    parseModels(json): ModelInfo[] {
      const rows = (json as { data?: Array<{ id?: unknown; name?: unknown }> } | null)?.data ?? [];
      return rows
        .filter((r) => typeof r.id === "string" && (o.modelFilter === undefined || o.modelFilter.test(String(r.id))))
        .map((r) => ({ id: String(r.id), ...(typeof r.name === "string" ? { label: r.name } : {}) }));
    },
  };
}

export const openai = openaiCompatible({ id: "openai", base: "https://api.openai.com/v1", tokenField: "max_completion_tokens", cacheKey: true, router: false, modelFilter: /^(gpt|o\d|chatgpt|codex)/i, defaultMaxOutput: 16_384 });
export const openrouter = openaiCompatible({ id: "openrouter", base: "https://openrouter.ai/api/v1", tokenField: "max_tokens", cacheKey: false, router: true, defaultMaxOutput: 16_384 });
export const xai = openaiCompatible({ id: "xai", base: "https://api.x.ai/v1", tokenField: "max_tokens", cacheKey: false, router: false, defaultMaxOutput: 16_384 });

// OpenCode Go (opencode.ai docs, 30 Oct 2026): chat completions at /inference/go/openai/v1/chat/completions, the model list at /inference/go/v1/models. Auth is a bearer key from the OpenCode Console (the docs
// show the key being pasted into /connect and do not name the header; Bearer is the OpenAI-compatible default). Needs a real account to prove. Models behind other wire formats (Responses, Anthropic Messages) are not served by this adapter.
export const opencodeGo = openaiCompatible({ id: "opencode_go", base: "https://opencode.ai/inference/go/openai/v1", tokenField: "max_tokens", cacheKey: false, router: false, defaultMaxOutput: 16_384, modelsUrl: "https://opencode.ai/inference/go/v1/models" });
/** A server on this computer or network that speaks Chat Completions (Ollama at :11434, LM Studio at :1234, llama.cpp server at :8080). No key. The account names its own address. */
export const local = openaiCompatible({ id: "local", base: "http://localhost:11434/v1", tokenField: "max_tokens", cacheKey: false, router: false, defaultMaxOutput: 8_192 });
/** An endpoint a Space registered (providers.custom_add). The account names the address; the key, when there is one, comes from the Vault by handle. */
export const custom = openaiCompatible({ id: "custom", base: "https://invalid.example/v1", tokenField: "max_tokens", cacheKey: false, router: false, defaultMaxOutput: 8_192 });

/** The base a local server's address means: `http://localhost:11434` and `http://localhost:11434/v1` both reach `/v1`. */
export function withV1(address: string): string {
  const u = address.replace(/\/+$/, "");
  return /\/v1$/.test(u) ? u : `${u}/v1`;
}
