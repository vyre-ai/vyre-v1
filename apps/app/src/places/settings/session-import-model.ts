import { relativeDate } from "../../onboarding/sessions-model.ts";
import type { SessionPayload, SessionSource } from "../../../../../client/src/session-import/parse.ts";
export interface SessionPreview { source: SessionSource; session: SessionPayload; at: number }
/** The confirmation button is the only call site that constructs a write payload. */
export function confirmedSessionInput(preview: SessionPreview | null, now: number) {
  if (!preview || !preview.session.messages.length) throw new Error("Preview a session with visible messages before importing.");
  return { provider: preview.source.provider === "claude" ? "claude_code" : "codex", sourceKey: preview.source.sessionKey,
    consent: { previewedAt: preview.at, confirmedAt: Math.max(preview.at, now) }, destination: { kind: "personal" },
    sessions: [preview.session], idempotencyKey: `sessions:${preview.source.sessionKey}:${preview.at}` };
}

/** What an archive row says: the source mark key, the one-line title and the date as the note. Never the raw provider key. */
export function archiveRow(a: { provider: string; title: string; startedAt?: number }, now: number): { mark: string; title: string; note: string } {
  return { mark: a.provider === "codex" ? "openai" : "claude", title: a.title.replace(/\s+/g, " ").trim() || "Untitled session", note: relativeDate(a.startedAt ?? 0, now) };
}
