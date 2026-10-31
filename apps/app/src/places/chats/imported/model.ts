// Imported coding sessions in Chats: the pure part. The archive rows the sidebar lists (newest first), the group's default open state, the one-line header of a transcript,
// and the transcript turned into the items the page draws. No React and no I/O, so it runs under plain node.
export type ImportProvider = "claude_code" | "codex";

/** One archive row as sessions.list answers it. */
export interface ImportedRow {
  conversationId: string;
  provider: string;
  title: string;
  startedAt: number;
  importedAt: number;
  continuedThreadId?: string | undefined;
}

export interface ImportedTool { id?: string; name: string; summary: string; ok?: boolean | undefined }
export interface ImportedMessage { sourceMessageId?: string; role: string; text: string; at: number; tools?: ImportedTool[] | undefined }

/** More than this many imported sessions and the group starts folded. */
export const IMPORTED_OPEN_MAX = 5;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const providerName = (provider: string): string => (provider === "codex" ? "Codex" : "Claude Code");
/** The ProviderLogo key of a provider. */
export const providerMark = (provider: string): string => (provider === "codex" ? "openai" : "claude");

/** `Oct 27`, with the year when it is not this year. */
export function dayLabel(ts: number, now: number, offsetMin: number): string {
  const d = new Date(ts + offsetMin * 60_000), n = new Date(now + offsetMin * 60_000);
  const base = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return d.getUTCFullYear() === n.getUTCFullYear() ? base : `${base}, ${d.getUTCFullYear()}`;
}

/** Newest first by when the session started, else when it was imported; ties keep a stable order by id. A malformed row is dropped. */
export function importedRows(list: readonly Partial<ImportedRow>[] | undefined): ImportedRow[] {
  const out: ImportedRow[] = [];
  for (const r of list ?? []) {
    if (typeof r.conversationId !== "string" || r.conversationId === "") continue;
    out.push({
      conversationId: r.conversationId, provider: typeof r.provider === "string" ? r.provider : "claude_code",
      title: typeof r.title === "string" && r.title.trim() !== "" ? r.title.trim() : "Imported session",
      startedAt: Number(r.startedAt) || 0, importedAt: Number(r.importedAt) || 0,
      ...(typeof r.continuedThreadId === "string" && r.continuedThreadId !== "" ? { continuedThreadId: r.continuedThreadId } : {}),
    });
  }
  return out.sort((a, b) => (b.startedAt || b.importedAt) - (a.startedAt || a.importedAt) || a.conversationId.localeCompare(b.conversationId));
}

export const importedStartsOpen = (count: number): boolean => count <= IMPORTED_OPEN_MAX;

/** "Imported from Claude Code, Oct 27, site": the folder is left out when the archive does not know it. */
export function headerLine(provider: string, startedAt: number, now: number, offsetMin: number, folder?: string): string {
  return ["Imported from " + providerName(provider), dayLabel(startedAt, now, offsetMin), folder ?? ""].filter((x) => x !== "").join(", ");
}

export type ImportedItem =
  | { key: string; kind: "me"; text: string }
  | { key: string; kind: "other"; text: string; tools: ImportedTool[]; toolLabel: string };

/** The line over a fold of tool calls: "3 tool calls", "1 tool call, 1 failed". */
export function toolLabel(tools: readonly ImportedTool[]): string {
  const failed = tools.filter((t) => t.ok === false).length;
  return `${tools.length} tool ${tools.length === 1 ? "call" : "calls"}${failed > 0 ? `, ${failed} failed` : ""}`;
}

/** The transcript as items: a user turn is yours, an assistant turn carries its tool calls folded under it. */
export function importedItems(messages: readonly ImportedMessage[]): ImportedItem[] {
  return messages.map((m, i) => {
    const key = m.sourceMessageId ?? `m${i}`;
    if (m.role === "user") return { key, kind: "me" as const, text: m.text };
    const tools = (m.tools ?? []).map((t) => ({ ...t }));
    return { key, kind: "other" as const, text: m.text, tools, toolLabel: toolLabel(tools) };
  });
}
