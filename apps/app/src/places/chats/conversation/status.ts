// How a turn that ended without a reply reads in a chat. The engine bridge posts it as a turn_status block (modules/engine/handlers/bridge.ts); its name and codes are internal and never shown.
import type { MessageBlock } from "./model.ts";

const str = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v) : "");
const dataOf = (b: MessageBlock): Record<string, unknown> => (typeof b.data === "object" && b.data !== null && !Array.isArray(b.data) ? (b.data as Record<string, unknown>) : {});

/** The block the engine bridge posts when a turn ends without a reply (failed, stopped, parked on an approval). It is never drawn as a card with its own name. */
export const isTurnStatus = (b: Pick<MessageBlock, "type">): boolean => b.type === "turn_status";

const STATUS_WORDS: Record<string, { message: string; cause?: string; next?: { key: string; label: string }[]; retryable: boolean }> = {
  no_account: { message: "Connect your AI to get replies.", cause: "No AI account is saved for this chat yet.", next: [{ key: "connect_ai", label: "Connect your AI" }], retryable: false },
  account_unavailable: { message: "Your AI account could not be reached just now.", next: [{ key: "connect_ai", label: "Check your AI account" }], retryable: true },
  "engine.server_off": { message: "Your server is off, so this chat did not run.", retryable: true },
  "engine.link_insecure": { message: "Your server needs a secure link (https) before it can run your chats.", retryable: true },
  "engine.cli_missing": { message: "The engine is not installed on your server.", retryable: true },
  "sandbox.unavailable": { message: "Your server cannot sandbox the engine.", retryable: true },
  turn_timeout: { message: "That took too long, so it was stopped.", retryable: true },
};

/** How a turn_status block reads: a failed turn is the inline error row with a plain sentence and one action; a stopped or parked turn is a quiet line. */
export type StatusView = { kind: "error"; block: MessageBlock } | { kind: "note"; id: string; text: string } | { kind: "approval"; id: string; taskId: string };

export function statusView(b: MessageBlock): StatusView {
  const d = dataOf(b);
  const state = str(d.state);
  if (state === "cancelled") return { kind: "note", id: b.id, text: "Stopped." };
  if (state === "waiting" && str(d.taskId) !== "") return { kind: "approval", id: b.id, taskId: str(d.taskId) };
  if (state === "waiting") return { kind: "note", id: b.id, text: "Waiting for your approval." };
  const w = STATUS_WORDS[str(d.code)] ?? { message: "That reply did not finish.", retryable: true };
  return { kind: "error", block: { ...b, type: "error", data: { code: str(d.code), message: w.message, ...(w.cause ? { cause: w.cause } : {}), next: w.next ?? [], retryable: w.retryable, turnId: str(d.turnId) } } };
}

