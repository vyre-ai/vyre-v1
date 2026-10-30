// Export a chat as a file a person keeps: Markdown to read, JSON to process. Built from the messages the signed-in person can read (the same chat.messages.list their screen uses), so the file never holds
// more than the screen could show, and every author and file is named by its real name. Pure: no capability calls here; actions.ts reads the pages and hands them in.
import { cardLine, isCard, isErrorBlock, titleOf, workOf } from "./model.ts";
import type { Message, Thread } from "./model.ts";

export type ExportFormat = "md" | "json";

export interface ExportInput {
  thread: Thread;
  messages: readonly Message[];
  nameOf(id: string): string;
  /** Name of an attached file; falls back to "File" for one the person cannot open. */
  fileName(fileId: string): string;
  /** Local time of day, "14:05". */
  clock: { now: number; offsetMin: number };
  exportedAt?: number;
}

const pad = (n: number): string => String(n).padStart(2, "0");
function stamp(ts: number, offsetMin: number): string {
  const d = new Date(ts + offsetMin * 60_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** A file name from the chat's title: letters, digits and dashes, 60 characters at most. */
export function exportName(title: string, format: ExportFormat): string {
  const slug = title.normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "chat";
  return `${slug}.${format}`;
}

export const exportMime = (format: ExportFormat): string => (format === "md" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8");

function blockLines(m: Message): string[] {
  const out: string[] = [];
  const work = workOf(m);
  if (work) out.push(`> ${work.summary}`);
  for (const b of m.blocks.filter(isCard)) {
    const c = cardLine(b);
    if (b.type === "fork_origin" || b.type === "refs") continue;
    out.push(`> [${c.type.replaceAll("_", " ")}] ${c.title}${c.sub ? `, ${c.sub}` : ""}`);
  }
  for (const b of m.blocks.filter(isErrorBlock)) out.push(`> [error] ${cardLine(b).title}`);
  return out;
}

export function exportMarkdown(i: ExportInput): string {
  const title = titleOf(i.thread, i.nameOf);
  const who = [...i.thread.members.filter((p) => p.kind === "person").map((p) => i.nameOf(p.id)), ...i.thread.agents.map((a) => i.nameOf(a.agentId))];
  const lines: string[] = [`# ${title}`, "", `Exported ${stamp(i.exportedAt ?? i.clock.now, i.clock.offsetMin)}. ${i.messages.length} ${i.messages.length === 1 ? "message" : "messages"}. With ${who.join(", ") || "no one else"}.`, ""];
  for (const m of i.messages) {
    if (m.kind === "system" || m.kind === "quiet") { lines.push(`_${m.body}_`, ""); continue; }
    lines.push(`**${i.nameOf(m.author.id)}** · ${stamp(m.createdAt, i.clock.offsetMin)}${m.pinned ? " · pinned" : ""}`, "");
    if (m.body.trim() !== "") lines.push(m.body.trimEnd(), "");
    for (const f of m.attachments) lines.push(`Attached: ${i.fileName(f)}`);
    if (m.attachments.length > 0) lines.push("");
    const extra = blockLines(m);
    if (extra.length > 0) lines.push(...extra, "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function exportJson(i: ExportInput): string {
  const doc = {
    exportedAt: new Date(i.exportedAt ?? i.clock.now).toISOString(),
    thread: {
      id: i.thread.threadId, title: titleOf(i.thread, i.nameOf), kind: i.thread.kind,
      people: i.thread.members.filter((p) => p.kind === "person").map((p) => ({ id: p.id, name: i.nameOf(p.id) })),
      agents: i.thread.agents.map((a) => ({ id: a.agentId, name: i.nameOf(a.agentId), mode: a.mode, ...(a.model ? { model: a.model } : {}) })),
    },
    messages: i.messages.map((m) => ({
      id: m.messageId, seq: m.threadSeq, at: new Date(m.createdAt).toISOString(), author: { id: m.author.id, name: i.nameOf(m.author.id), kind: m.author.kind },
      kind: m.kind, body: m.body, ...(m.replyTo ? { replyTo: m.replyTo } : {}), pinned: m.pinned,
      attachments: m.attachments.map((f) => ({ id: f, name: i.fileName(f) })),
      blocks: m.blocks.map((b) => ({ type: b.type, state: b.state, data: b.data })),
      ...(m.reactions.length > 0 ? { reactions: m.reactions.map((r) => ({ emoji: r.emoji, by: r.by.map(i.nameOf) })) } : {}),
    })),
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function exportAs(format: ExportFormat, i: ExportInput): { name: string; mime: string; content: string } {
  return { name: exportName(titleOf(i.thread, i.nameOf), format), mime: exportMime(format), content: format === "md" ? exportMarkdown(i) : exportJson(i) };
}

