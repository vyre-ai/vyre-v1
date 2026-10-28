// Pure parsing boundary shared by packaged clients. Never reads local files.
export interface SessionSource { provider: "codex" | "claude"; sessionId: string; sessionKey: string; cwd?: string | null; gitOriginUrl?: string | null }
export interface SessionMessage { sourceMessageId: string; role: "user" | "assistant"; text: string; at: number }
export interface SessionPayload { sourceSessionId: string; title: string; startedAt: number; repo?: { root?: string; remote?: string }; messages: SessionMessage[] }
const object = (v: unknown): Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {};
function remote(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (/^git@[^:]+:[^\s]+$/.test(value)) return value;
  try { const url = new URL(value); if (!["https:", "http:", "ssh:"].includes(url.protocol)) return undefined; url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.toString(); } catch { return undefined; }
}
export function parseSession(source: SessionSource, text: string): SessionPayload {
  const messages: SessionMessage[] = [];
  const ids = new Set<string>();
  let root = source.cwd ?? undefined, origin = remote(source.gitOriginUrl);
  const lines = text.split("\n");
  for (const [index, raw] of lines.entries()) {
    if (!raw.trim()) continue;
    let line: Record<string, unknown>;
    try { line = object(JSON.parse(raw)); } catch {
      if (index === lines.length - 1) continue;
      throw new Error("This transcript contains an unreadable JSONL record.");
    }
    const payload = object(line.payload);
    if (line.type === "session_meta") {
      if (typeof payload.cwd === "string") root = payload.cwd;
      origin = remote(object(payload.git).repository_url) ?? origin;
    }
    if (!root && typeof line.cwd === "string") root = line.cwd;
    const m = source.provider === "codex" ? payload : object(line.message);
    if (source.provider === "codex" ? line.type !== "response_item" || m.type !== "message" : line.type !== "user" && line.type !== "assistant") continue;
    if (m.role !== "user" && m.role !== "assistant") continue;
    const content = m.content;
    const visible = typeof content === "string" && source.provider === "claude" ? content : Array.isArray(content) ? content.flatMap((v) => {
      const p = object(v);
      return (p.type === "text" || p.type === "input_text" || p.type === "output_text") && typeof p.text === "string" ? [p.text] : [];
    }).join("\n") : "";
    if (!visible.trim()) continue;
    const sourceMessageId = String(source.provider === "claude" ? line.uuid ?? `line:${index}` : m.id ?? `line:${index}`);
    if (ids.has(sourceMessageId)) continue;
    ids.add(sourceMessageId);
    const at = typeof line.timestamp === "string" ? Date.parse(line.timestamp) : NaN;
    messages.push({ sourceMessageId, role: m.role, text: visible, at: Number.isFinite(at) ? at : index });
  }
  return { sourceSessionId: source.sessionId, title: messages.find((m) => m.role === "user")?.text.slice(0, 100) ?? "Imported session", startedAt: messages[0]?.at ?? 0, ...(root || origin ? { repo: { ...(root ? { root } : {}), ...(origin ? { remote: origin } : {}) } } : {}), messages };
}
