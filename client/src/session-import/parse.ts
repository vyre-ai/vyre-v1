// Pure parsing boundary shared by packaged clients. Never reads local files.
import { sanitizeImportedText } from "../../../lib/import-text.ts";
export interface SessionSource { provider: "codex" | "claude"; sessionId: string; sessionKey: string; cwd?: string | null; title?: string | null; updatedAt?: string | null; gitOriginUrl?: string | null; repositoryMetadataAuthoritative?: boolean }
export interface SessionDocument { namespace: string; text: string }
export interface SessionTool { id: string; name: string; summary: string; ok?: boolean; output?: string }
export interface SessionMessage { sourceMessageId: string; role: "user" | "assistant"; text: string; at: number; tools?: SessionTool[] }
export interface SessionPayload { sourceSessionId: string; title: string; startedAt: number; repo?: { root?: string; remote?: string }; messages: SessionMessage[] }
const object = (v: unknown): Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {};
function remote(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (/^git@[^:]+:[^\s]+$/.test(value)) return value;
  try { const url = new URL(value); if (!["https:", "http:", "ssh:"].includes(url.protocol)) return undefined; url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.toString(); } catch { return undefined; }
}
const clip = (v: unknown, n: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
const asObject = (v: unknown): Record<string, unknown> => { if (typeof v === "string") { try { return object(JSON.parse(v)); } catch { return {}; } } return object(v); };

/** What a person reads for a tool call: "Edit src/app.ts", "Run npm test", "Search for TODO". The words come from the call's own fields; nothing is guessed. */
export function describeTool(name: string, rawInput: unknown): string {
  const i = asObject(rawInput);
  const path = clip(i.file_path ?? i.notebook_path ?? i.path, 160);
  const cmdRaw = i.command ?? i.cmd;
  const cmd = clip(Array.isArray(cmdRaw) ? cmdRaw.join(" ") : cmdRaw, 200);
  const lower = name.toLowerCase();
  if (cmd !== "" && /bash|shell|exec|run|terminal/.test(lower)) return `Run ${cmd}`;
  if (/^(edit|multiedit|notebookedit|apply_patch|str_replace)/.test(lower)) return `Edit ${path || "a file"}`;
  if (/^(write|create)/.test(lower)) return `Write ${path || "a file"}`;
  if (/^read|view/.test(lower)) return `Read ${path || "a file"}`;
  if (/grep|search|glob|find/.test(lower)) return `Search for ${clip(i.pattern ?? i.query ?? i.glob, 120) || "files"}`;
  if (/fetch|web/.test(lower)) return `Fetch ${clip(i.url ?? i.query, 160) || "a page"}`;
  if (/task|agent/.test(lower)) return `Ask a sub-agent: ${clip(i.description ?? i.prompt, 120) || name}`;
  if (cmd !== "") return `${name} ${cmd}`;
  return path ? `${name} ${path}` : name;
}

/** A tool result as text: a string as it is, content blocks joined, an object as compact JSON. */
function resultOf(v: unknown): string {
  if (typeof v === "string") { const o = v.trim().startsWith("{") ? asObject(v) : {}; return typeof o.output === "string" ? o.output : v; }
  if (Array.isArray(v)) return v.map((b) => (typeof b === "string" ? b : typeof object(b).text === "string" ? String(object(b).text) : "")).filter(Boolean).join("\n");
  const o = object(v);
  if (typeof o.output === "string") return o.output;
  try { return JSON.stringify(v) ?? ""; } catch { return ""; }
}

function parseDocument(source: SessionSource, text: string, namespace: string): SessionPayload {
  const messages: SessionMessage[] = [];
  const ids = new Set<string>();
  const authoritativeRepository = source.repositoryMetadataAuthoritative === true;
  let root = source.cwd ?? undefined, origin = remote(source.gitOriginUrl);
  const lines = text.split("\n");
  const tools = new Map<string, SessionTool>();                // call id -> the tool on its message, so a result that arrives later finds it
  const toolsOf = new Map<string, SessionMessage>();            // call id -> the message it belongs to
  const slot = (id: string, sourceMessageId: string, at: number, tool: SessionTool): void => {
    if (!id || tools.has(id)) return;
    tools.set(id, tool);
    let m = messages.find((x) => x.sourceMessageId === sourceMessageId);
    if (!m) { m = { sourceMessageId, role: "assistant", text: "", at, tools: [] }; messages.push(m); }
    (m.tools ??= []).push(tool);
    toolsOf.set(id, m);
  };
  const result = (id: string, ok: boolean | undefined, content: unknown): void => {
    const t = tools.get(id);
    if (!t) return;
    const out = sanitizeImportedText(resultOf(content).slice(0, 4000)).slice(0, 2000);
    if (out !== "") t.output = out;
    if (ok !== undefined) t.ok = ok;
  };
  for (const [index, raw] of lines.entries()) {
    if (!raw.trim()) continue;
    let line: Record<string, unknown>;
    try { line = object(JSON.parse(raw)); } catch { continue; }
    const payload = object(line.payload);
    if (line.type === "session_meta") {
      if (!authoritativeRepository && typeof payload.cwd === "string") root = payload.cwd;
      if (!authoritativeRepository) origin = remote(object(payload.git).repository_url) ?? origin;
    }
    if (!authoritativeRepository && !root && typeof line.cwd === "string") root = line.cwd;
    const m = source.provider === "codex" ? payload : object(line.message);
    const stamp = typeof line.timestamp === "string" && Number.isFinite(Date.parse(line.timestamp)) ? Date.parse(line.timestamp) : index;
    const ns = (id: string): string => (namespace === "main" || namespace === "" ? id : `${namespace}:${id}`);
    if (source.provider === "codex" && line.type === "response_item") {
      const pt = String(m.type);
      const callId = typeof m.call_id === "string" ? m.call_id : typeof m.id === "string" ? m.id : "";
      if (pt === "function_call" || pt === "custom_tool_call" || pt === "local_shell_call") {
        const name = typeof m.name === "string" ? m.name : pt === "local_shell_call" ? "shell" : "tool";
        const input = pt === "local_shell_call" ? object(m.action) : pt === "custom_tool_call" ? m.input : m.arguments;
        slot(callId, ns(`tool:${callId}`), stamp, { id: callId, name: clip(name, 80), summary: sanitizeImportedText(describeTool(name, input)) });
        continue;
      }
      if (pt === "function_call_output" || pt === "custom_tool_call_output") { result(callId, undefined, m.output); continue; }
    }
    if (source.provider === "claude" && (line.type === "assistant" || line.type === "user") && Array.isArray(m.content)) {
      const lineId = String(line.uuid ?? `line:${index}`);
      for (const b of m.content) {
        const blk = object(b);
        if (line.type === "assistant" && blk.type === "tool_use" && typeof blk.id === "string") {
          const name = typeof blk.name === "string" ? blk.name : "tool";
          slot(blk.id, ns(lineId), stamp, { id: blk.id, name: clip(name, 80), summary: sanitizeImportedText(describeTool(name, blk.input)) });
        } else if (line.type === "user" && blk.type === "tool_result" && typeof blk.tool_use_id === "string") result(blk.tool_use_id, blk.is_error === true ? false : true, blk.content);
      }
    }
    if (source.provider === "codex" ? line.type !== "response_item" || m.type !== "message" : line.type !== "user" && line.type !== "assistant") continue;
    if (m.role !== "user" && m.role !== "assistant") continue;
    if (m.role === "assistant" && (m.channel === "analysis" || m.channel === "reasoning")) continue;
    const content = m.content;
    const visible = typeof content === "string" && source.provider === "claude" ? content : Array.isArray(content) ? content.flatMap((v) => {
      const p = object(v);
      return (p.type === "text" || p.type === "input_text" || p.type === "output_text") && typeof p.text === "string" ? [p.text] : [];
    }).join("\n") : "";
    const safeText = sanitizeImportedText(visible);
    if (!safeText) continue;
    const rawId = String(source.provider === "claude" ? line.uuid ?? `line:${index}` : m.id ?? `line:${index}`);
    const sourceMessageId = namespace === "main" || namespace === "" ? rawId : `${namespace}:${rawId}`;
    if (ids.has(sourceMessageId)) continue;
    const at = typeof line.timestamp === "string" ? Date.parse(line.timestamp) : NaN;
    const had = messages.find((x) => x.sourceMessageId === sourceMessageId);
    if (had) { had.text = safeText; continue; }   // a Claude line that also made tool calls: one message, the words and the calls
    ids.add(sourceMessageId);
    messages.push({ sourceMessageId, role: m.role, text: safeText, at: Number.isFinite(at) ? at : index });
  }
  return { sourceSessionId: source.sessionId, title: messages.find((m) => m.role === "user")?.text.slice(0, 100) ?? "Imported session", startedAt: messages[0]?.at ?? 0, ...(root || origin ? { repo: { ...(root ? { root } : {}), ...(origin ? { remote: origin } : {}) } } : {}), messages };
}

export function parseSession(source: SessionSource, text: string): SessionPayload {
  return parseDocument(source, text, "main");
}

/** Merge one selected session with its native-discovered child transcripts. The cap keeps preview and upload bounded even when a provider store is pathological. */
export function parseSessionDocuments(source: SessionSource, documents: readonly SessionDocument[]): SessionPayload {
  const MAX_MESSAGES = 5_000;
  const parts = documents.map((document) => parseDocument(source, document.text, document.namespace));
  const primary = parts[0] ?? parseDocument(source, "", "main");
  const messages: SessionMessage[] = [];
  const ids = new Set<string>();
  documents: for (const part of parts) for (const message of part.messages) {
    if (ids.has(message.sourceMessageId)) continue;
    ids.add(message.sourceMessageId);
    messages.push(message);
    if (messages.length === MAX_MESSAGES) break documents;
  }
  return { ...primary, title: messages.find((message) => message.role === "user")?.text.slice(0, 100) ?? primary.title, startedAt: messages[0]?.at ?? primary.startedAt, messages };
}
