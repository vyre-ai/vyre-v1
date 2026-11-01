// How a turn that ended without a reply reads in a chat. The engine bridge posts it as a turn_status block (modules/engine/handlers/bridge.ts); its name and codes are internal and never shown.
import type { MessageBlock } from "./model.ts";

const str = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v) : "");
const dataOf = (b: MessageBlock): Record<string, unknown> => (typeof b.data === "object" && b.data !== null && !Array.isArray(b.data) ? (b.data as Record<string, unknown>) : {});

/** The block the engine bridge posts when a turn ends without a reply (failed, stopped, parked on an approval). It is never drawn as a card with its own name. */
export const isTurnStatus = (b: Pick<MessageBlock, "type">): boolean => b.type === "turn_status";

/** The engines a person can install, and the exact command (the same as images/vyred/Dockerfile installs). Grok has none we can name. */
const ENGINES: Record<string, { name: string; command?: string }> = {
  claude: { name: "Claude", command: "npm install -g @anthropic-ai/claude-code" },
  codex: { name: "Codex", command: "npm install -g @openai/codex" },
  grok: { name: "Grok" },
};
/** The command behind an `install:<program>` action, or undefined. */
export const installCommand = (key: string): string | undefined => (key.startsWith("install:") ? ENGINES[key.slice(8)]?.command : undefined);

const STATUS_WORDS: Record<string, { message: string; cause?: string; next?: { key: string; label: string }[]; retryable: boolean }> = {
  no_account: { message: "Connect your AI to get replies.", cause: "No AI account is saved for this chat yet.", next: [{ key: "connect_ai", label: "Connect your AI" }], retryable: false },
  account_unavailable: { message: "Your AI account could not be reached just now.", next: [{ key: "connect_ai", label: "Check your AI account" }], retryable: true },
  "engine.server_off": { message: "Your server is off, so this chat did not run.", retryable: true },
  "engine.link_insecure": { message: "Your server needs a secure link (https) before it can run your chats.", retryable: true },
  "engine.cli_missing": { message: "The engine is not installed here.", next: [{ key: "connect_ai", label: "Connect an account" }], retryable: true },
  "engine.vault_locked": { message: "Your Vault is locked.", cause: "Unlock it to let this chat use your AI account.", next: [{ key: "unlock_vault", label: "Unlock" }], retryable: false },
  "engine.vault_unreadable": { message: "Your Vault could not be read just now.", next: [{ key: "open_vault", label: "Open the Vault" }], retryable: true },
  "sandbox.unavailable": { message: "Your server cannot sandbox the engine.", retryable: true },
  "engine.post_failed": { message: "The reply was written but could not be shown.", cause: "Try again.", retryable: true },
  turn_timeout: { message: "That took too long, so it was stopped.", retryable: true },
  host_lost: { message: "The server stopped while this was running.", cause: "It may have done part of the work. Check before running it again.", retryable: true },
  agent_paused: { message: "This agent is paused, so it did not answer.", cause: "Resume it from its page, then try again.", retryable: true },
  agent_gone: { message: "This agent was deleted, so it did not answer.", retryable: false },
};

/** How a turn_status block reads: a failed turn is the inline error row with a plain sentence and one action; a stopped or parked turn is a quiet line. */
export type StatusView = { kind: "error"; block: MessageBlock } | { kind: "note"; id: string; text: string } | { kind: "approval"; id: string; taskId: string };

export function statusView(b: MessageBlock): StatusView {
  const d = dataOf(b);
  const state = str(d.state);
  if (state === "note" && str(d.text) !== "") return { kind: "note", id: b.id, text: str(d.text) };
  if (state === "cancelled") return { kind: "note", id: b.id, text: "Stopped." };
  if (state === "waiting" && str(d.taskId) !== "") return { kind: "approval", id: b.id, taskId: str(d.taskId) };
  if (state === "waiting") return { kind: "note", id: b.id, text: "Waiting for your approval." };
  let w = STATUS_WORDS[str(d.code)] ?? { message: "That reply did not finish.", retryable: true };
  // The engine that is missing is named, with the command that installs it; the reason the Vault refused is the one it gave.
  const engine = ENGINES[str(d.program)];
  if (str(d.code) === "engine.cli_missing" && engine) {
    w = { message: `${engine.name} is not installed here.`, ...(engine.command ? { cause: `Run ${engine.command}, then try again.` } : {}), next: [...(engine.command ? [{ key: `install:${str(d.program)}`, label: `Install ${engine.name}` }] : []), ...(w.next ?? [])], retryable: true };
  }
  if (str(d.code) === "engine.vault_unreadable" && str(d.reason) !== "") w = { ...w, cause: `The Vault answered: ${str(d.reason)}.` };
  return { kind: "error", block: { ...b, type: "error", data: { code: str(d.code), message: w.message, ...(w.cause ? { cause: w.cause } : {}), next: w.next ?? [], retryable: w.retryable, turnId: str(d.turnId) } } };
}

