// Gemini streamGenerateContent over server-sent events. Gemini sends a function call whole, never in pieces, and gives no call id, so the decoder makes one that is stable within the turn.
import { orderSystem, sortTools } from "./prefix.ts";
import type { CallRequest, Decoded, ModelInfo, ProviderAdapter, SseEvent, StreamDecoder, Usage, WireRequest } from "./types.ts";

/** Gemini takes an OpenAPI subset: no $schema, additionalProperties, or $ref. Anything it cannot read is dropped, never rewritten. */
export function geminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (schema === null || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === "$schema" || k === "additionalProperties" || k === "$id" || k === "$ref" || k === "definitions" || k === "$defs") continue;
    out[k] = k === "properties" && v !== null && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([n, s]) => [n, geminiSchema(s)])) : geminiSchema(v);
  }
  return out;
}

function wireContents(req: CallRequest): unknown[] {
  const out: Array<{ role: string; parts: unknown[] }> = [];
  const push = (role: string, part: unknown): void => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts.push(part); else out.push({ role, parts: [part] });
  };
  for (const m of req.messages) {
    if (m.role === "user") push("user", { text: m.text });
    else if (m.role === "tool") push("user", { functionResponse: { name: m.name, response: m.ok ? { result: m.content } : { error: m.content } } });
    else {
      if (m.text) push("model", { text: m.text });
      for (const c of m.calls) push("model", { functionCall: { name: c.name, args: c.input ?? {} } });
      if (!m.text && m.calls.length === 0) push("model", { text: "(no reply)" });
    }
  }
  return out;
}

function decoder(): StreamDecoder {
  let n = 0;
  return {
    push(ev: SseEvent): Decoded[] {
      let j: Record<string, any>;
      try { j = JSON.parse(ev.data) as Record<string, any>; } catch { return []; }
      if (j["error"]) {
        const e = j["error"] as Record<string, any>;
        return [{ type: "error", status: typeof e["code"] === "number" ? e["code"] : 200, code: String(e["status"] ?? "error"), message: String(e["message"] ?? "The provider reported an error.") }];
      }
      const out: Decoded[] = [];
      const cand = (j["candidates"] as Array<Record<string, any>> | undefined)?.[0];
      let sawCall = false;
      for (const p of (cand?.["content"]?.parts as Array<Record<string, any>> | undefined) ?? []) {
        if (typeof p["text"] === "string" && p["text"] !== "") out.push({ type: p["thought"] === true ? "thinking" : "text", text: p["text"] });
        else if (p["functionCall"]) {
          sawCall = true;
          const fc = p["functionCall"] as Record<string, any>;
          n += 1;
          out.push({ type: "tool_call", call: { id: typeof fc["id"] === "string" && fc["id"] !== "" ? fc["id"] : `gcall_${n}`, name: String(fc["name"]), input: fc["args"] ?? {} } });
        }
      }
      const um = j["usageMetadata"] as Record<string, any> | undefined;
      if (um) {
        const usage: Partial<Usage> = {};
        if (typeof um["promptTokenCount"] === "number") usage.inputTokens = um["promptTokenCount"];
        if (typeof um["candidatesTokenCount"] === "number") usage.outputTokens = um["candidatesTokenCount"] + (typeof um["thoughtsTokenCount"] === "number" ? um["thoughtsTokenCount"] : 0);
        if (typeof um["cachedContentTokenCount"] === "number") usage.cacheReadTokens = um["cachedContentTokenCount"];
        out.push({ type: "usage", usage });
      }
      const reason = cand?.["finishReason"] as string | undefined;
      if (reason) out.push({ type: "stop", reason: sawCall ? "tool_use" : reason === "STOP" ? "end" : reason === "MAX_TOKENS" ? "length" : reason === "SAFETY" || reason === "RECITATION" || reason === "PROHIBITED_CONTENT" ? "filtered" : "other" });
      return out;
    },
    end: () => [],
  };
}

export const google: ProviderAdapter = {
  id: "google",
  defaultBase: "https://generativelanguage.googleapis.com",
  defaultMaxOutput: 16_384,
  inputIncludesCache: true,
  modelName: (m) => (m.startsWith("google/") ? m.slice("google/".length) : m.startsWith("models/") ? m.slice("models/".length) : m),
  request(req: CallRequest): WireRequest {
    const system = orderSystem(req.system).map((b) => b.text).join("\n\n");
    const decls = sortTools(req.tools).map((t) => ({ name: t.name, description: t.description, parameters: geminiSchema(t.inputSchema ?? { type: "object", properties: {} }) }));
    return {
      path: `/v1beta/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`,
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: {
        ...(system !== "" ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: wireContents(req),
        ...(decls.length > 0 ? { tools: [{ functionDeclarations: decls }] } : {}),
        generationConfig: { maxOutputTokens: req.maxOutputTokens },
      },
    };
  },
  decoder,
  modelsRequest: () => ({ path: "/v1beta/models?pageSize=200", headers: {} }),
  parseModels(json): ModelInfo[] {
    const rows = (json as { models?: Array<{ name?: unknown; displayName?: unknown; supportedGenerationMethods?: unknown }> } | null)?.models ?? [];
    return rows
      .filter((r) => typeof r.name === "string" && Array.isArray(r.supportedGenerationMethods) && r.supportedGenerationMethods.includes("generateContent"))
      .map((r) => ({ id: String(r.name).replace(/^models\//, ""), ...(typeof r.displayName === "string" ? { label: r.displayName } : {}) }));
  },
};
