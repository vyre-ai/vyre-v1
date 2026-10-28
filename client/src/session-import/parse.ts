// Pure parsing boundary shared by packaged clients. Never reads local files.
import { sanitizeImportedText } from "../../../lib/import-text.ts";
export interface SessionSource { provider: "codex" | "claude"; sessionId: string; sessionKey: string; cwd?: string | null; gitOriginUrl?: string | null }
export interface SessionDocument { namespace: string; text: string }
export interface SessionMessage { sourceMessageId: string; role: "user" | "assistant"; text: string; at: number }
export interface SessionPayload { sourceSessionId: string; title: string; startedAt: number; repo?: { root?: string; remote?: string }; messages: SessionMessage[] }
const object = (v: unknown): Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {};
function remote(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (/^git@[^:]+:[^\s]+$/.test(value)) return value;
  try { const url = new URL(value); if (!["https:", "http:", "ssh:"].includes(url.protocol)) return undefined; url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.toString(); } catch { return undefined; }
}
function parseDocument(source: SessionSource, text: string, namespace: string): SessionPayload {
  const messages: SessionMessage[] = [];
  const ids = new Set<string>();
  let root = source.cwd ?? undefined, origin = remote(source.gitOriginUrl);
  const lines = text.split("\n");
  for (const [index, raw] of lines.entries()) {
    if (!raw.trim()) continue;
    let line: Record<string, unknown>;
    try { line = object(JSON.parse(raw)); } catch { continue; }
    const payload = object(line.payload);
    if (line.type === "session_meta") {
      if (typeof payload.cwd === "string") root = payload.cwd;
      origin = remote(object(payload.git).repository_url) ?? origin;
    }
    if (!root && typeof line.cwd === "string") root = line.cwd;
    const m = source.provider === "codex" ? payload : object(line.message);
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
    ids.add(sourceMessageId);
    const at = typeof line.timestamp === "string" ? Date.parse(line.timestamp) : NaN;
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
