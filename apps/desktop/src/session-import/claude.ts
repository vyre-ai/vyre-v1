import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { completeJsonLines } from "./codex.ts";
import { isRecord } from "./discover.ts";
import type { ImportedSession, SessionSource, VisibleMessage } from "./types.ts";

type Ordered = VisibleMessage & { order: number };

export async function readClaudeSession(source: SessionSource): Promise<ImportedSession> {
  const warnings: string[] = [];
  const all = await claudeLines(source.transcriptPath, warnings);
  const subagents = path.join(source.transcriptPath.replace(/\.jsonl(?:\.gz)?$/i, ""), "subagents");
  for (const file of await subagentFiles(subagents)) all.push(...await claudeLines(file, warnings));
  const messages = all.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? "") || a.order - b.order).map(({ order: _order, ...message }) => message);
  return { provider: "claude", sessionId: source.sessionId, sessionKey: source.sessionKey, projectKey: source.projectKey, ...(source.cwd ? { cwd: source.cwd } : {}), messages, warnings };
}

async function claudeLines(file: string, warnings: string[]): Promise<Ordered[]> {
  const lines = file.endsWith(".gz") ? await gzipLines(file, warnings) : await completeJsonLines(file, warnings);
  const out: Ordered[] = [];
  for (const [order, line] of lines.entries()) {
    if (!isRecord(line) || (line.type !== "user" && line.type !== "assistant") || !isRecord(line.message) || line.message.role !== line.type || typeof line.uuid !== "string") continue;
    const text = visibleText(line.message.content);
    if (!text) continue;
    out.push({ id: line.uuid, ...(typeof line.parentUuid === "string" ? { parentId: line.parentUuid } : {}), role: line.type, text, ...(typeof line.timestamp === "string" ? { at: line.timestamp } : {}), order });
  }
  return out;
}

async function gzipLines(file: string, warnings: string[]): Promise<unknown[]> {
  const decoded = zlib.gunzipSync(await fs.readFile(file)).toString("utf8");
  const lines = decoded.split("\n");
  if (lines.pop() !== "") warnings.push("Ignored partial final JSONL record.");
  const out: unknown[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { warnings.push("Ignored corrupt JSONL record."); }
  }
  return out;
}

function visibleText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => isRecord(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : []).join("\n").trim();
}

async function subagentFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && /^agent-.*\.jsonl(?:\.gz)?$/i.test(entry.name)).map((entry) => path.join(dir, entry.name));
  } catch { return []; }
}
