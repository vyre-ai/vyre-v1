// How a turn that ended without a reply reads in a chat. The engine bridge posts it as a turn_status block (modules/engine/handlers/bridge.ts); its name and codes are internal and never shown.
import type { Message, MessageBlock } from "./model.ts";

const str = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v) : "");
const dataOf = (b: MessageBlock): Record<string, unknown> => (typeof b.data === "object" && b.data !== null && !Array.isArray(b.data) ? (b.data as Record<string, unknown>) : {});

/** The block the engine bridge posts when a turn ends without a reply (failed, stopped, parked on an approval). It is never drawn as a card with its own name. */
export const isTurnStatus = (b: Pick<MessageBlock, "type">): boolean => b.type === "turn_status";

/** A message that only says a turn failed: no words of its own. A failure that kept the reply's words is never dropped. */
const onlyFailure = (m: Pick<Message, "body" | "blocks">): boolean => m.body === "" && m.blocks.length > 0 && m.blocks.every((b) => isTurnStatus(b) && str(dataOf(b).state) === "failed");

/** The messages without any failure the same agent has since answered, by a reply or by a newer failure, with no person speaking in between. So a retry that works takes the card away, one that fails shows one card, and a failure someone talked past stays. Oldest first in and out; the same array when nothing goes. */
export function withoutAnswered<M extends Pick<Message, "messageId" | "author" | "body" | "blocks">>(messages: readonly M[]): readonly M[] {
  const gone = new Set<string>();
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.author.kind !== "agent" || !onlyFailure(m)) continue;
    for (const after of messages.slice(i + 1)) {
      if (after.author.kind === "person") break;
      if (after.author.id === m.author.id) { gone.add(m.messageId); break; }
    }
  }
  return gone.size === 0 ? messages : messages.filter((m) => !gone.has(m.messageId));
}

/** The engines Vyre installs by itself (modules/engine/engine-install.ts): the Install button runs the turn again, and the turn waits while Vyre sets the engine up. No command is shown. */
const ENGINES: Record<string, { name: string }> = { claude: { name: "Claude" }, codex: { name: "Codex" }, grok: { name: "Grok" } };
/** The program behind an `install:<program>` action, or undefined. */
export const installProgram = (key: string): string | undefined => (key.startsWith("install:") && Object.hasOwn(ENGINES, key.slice(8)) ? key.slice(8) : undefined);
/** Why Vyre's own install did not finish, as the turn's block says it (`setup`), in a sentence. */
const SETUP_WORDS: Record<string, string> = {
  offline: "This computer could not reach the download. Check the connection, then try again.",
  checksum: "The download did not match the expected file, so it was not used.",
  disk: "It could not be saved on this computer. Free some space, then try again.",
  failed: "The setup did not finish.",
};

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
  paid_fallback: { message: "This account is out for now.", cause: "A paid key could answer. It is in your Tasks for you to say yes.", retryable: false },
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
  // The engine that is missing is named with one button that installs it, and why the last try did not finish; one that has no build for this computer offers another account only. The reason the
  // Vault refused is the one it gave.
  const engine = Object.hasOwn(ENGINES, str(d.program)) ? ENGINES[str(d.program)] : undefined;
  if (str(d.code) === "engine.cli_missing" && engine) {
    const setup = str(d.setup);
    if (setup === "unsupported") w = { message: `${engine.name} cannot run on this computer.`, next: w.next ?? [], retryable: false };
    else {
      const cause = SETUP_WORDS[setup];
      w = { message: cause ? `${engine.name} could not be set up here.` : `${engine.name} is not installed here.`, cause: cause ?? "Vyre can set it up for you.", next: [{ key: `install:${str(d.program)}`, label: `Install ${engine.name}` }, ...(w.next ?? [])], retryable: false };
    }
  }
  if (str(d.code) === "engine.vault_unreadable" && str(d.reason) !== "") w = { ...w, cause: `The Vault answered: ${str(d.reason)}.` };
  return { kind: "error", block: { ...b, type: "error", data: { code: str(d.code), message: w.message, ...(w.cause ? { cause: w.cause } : {}), next: w.next ?? [], retryable: w.retryable, turnId: str(d.turnId), steps: [...(str(d.code) ? [["Code", str(d.code)]] : []), ["Reply", str(d.turnId)]] } } };
}

