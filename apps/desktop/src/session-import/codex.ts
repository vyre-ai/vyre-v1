import fs from "node:fs/promises";
import { isRecord } from "./discover.ts";
import type { ImportedSession, SessionSource, VisibleMessage } from "./types.ts";

export async function readCodexSession(source: SessionSource): Promise<ImportedSession> {
  const warnings: string[] = [];
  const messages: VisibleMessage[] = [];
  for (const line of await completeJsonLines(source.transcriptPath, warnings)) {
    if (!isRecord(line) || line.type !== "response_item" || !isRecord(line.payload)) {
      if (isRecord(line) && line.type === "event_msg") warnings.push("Ignored duplicate/non-canonical response_item event.");
      continue;
    }
    const payload = line.payload;
    if (payload.type !== "message" || (payload.role !== "user" && payload.role !== "assistant") || typeof payload.id !== "string") continue;
    const text = textContent(payload.content);
    if (!text) continue;
    messages.push({ id: payload.id, role: payload.role, text, ...(typeof line.timestamp === "string" ? { at: line.timestamp } : {}) });
  }
  return { provider: "codex", sessionId: source.sessionId, sessionKey: source.sessionKey, projectKey: source.projectKey, ...(source.cwd ? { cwd: source.cwd } : {}), messages, warnings };
}

export async function completeJsonLines(file: string, warnings: string[]): Promise<unknown[]> {
  const text = await fs.readFile(file, "utf8");
  const lines = text.split("\n");
  if (lines.pop() !== "") warnings.push("Ignored partial final JSONL record.");
  const out: unknown[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { warnings.push("Ignored corrupt JSONL record."); }
  }
  return out;
}

function textContent(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.flatMap((part) => isRecord(part) && (part.type === "input_text" || part.type === "output_text") && typeof part.text === "string" ? [part.text] : []).join("\n").trim();
}
