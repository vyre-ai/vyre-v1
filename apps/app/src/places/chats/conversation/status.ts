// How a turn that ended without a reply reads in a chat. The engine bridge posts it as a turn_status block (modules/engine/handlers/bridge.ts); its name and codes are internal and never shown.
import type { Message, MessageBlock } from "./model.ts";

const str = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v) : "");
const dataOf = (b: MessageBlock): Record<string, unknown> => (typeof b.data === "object" && b.data !== null && !Array.isArray(b.data) ? (b.data as Record<string, unknown>) : {});

/** The block the engine bridge posts when a turn ends without a reply (failed, stopped, parked on an approval). It is never drawn as a card with its own name. */
export const isTurnStatus = (b: Pick<MessageBlock, "type">): boolean => b.type === "turn_status";

/**
 * A line the engine says in the chat as the agent (the model swap, where a chat runs, files moved to Trash): no turn made it, so it has no Details. Its hover card read "Not recorded for this reply"
 * (the owner's rc.20 test), which is true of a line and useless.
 */
export const isSystemLine = (m: Pick<Message, "body" | "blocks">): boolean => m.body.trim() === "" && m.blocks.length > 0 && m.blocks.every((b) => isTurnStatus(b) && ["note", "device_wait", "trashed"].includes(str(dataOf(b).state)));

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
  "engine.device_off": { message: "Your computer is off, so this chat did not run.", next: [{ key: "run_on_server", label: "Run it on the server instead" }], retryable: true },
  "engine.device_gone": { message: "Your computer went away in the middle of this.", next: [{ key: "run_on_server", label: "Run it on the server instead" }], retryable: true },
  "engine.link_insecure": { message: "Your server needs a secure link (https) before it can run your chats.", retryable: true },
  "engine.cli_missing": { message: "The engine is not installed here.", next: [{ key: "connect_ai", label: "Connect an account" }], retryable: true },
  "engine.vault_locked": { message: "Your Vault key is not on this server.", cause: "Your AI sign-in cannot be opened until you are signed in on a device. Open Vyre there, then send again.", retryable: true },
  "engine.signin_missing": { message: "Your sign-in for this AI is missing.", cause: "Sign in again.", next: [{ key: "connect_ai", label: "Sign in again" }], retryable: false },
  "engine.cli_unusable": { message: "This engine cannot run on your computer as it is.", cause: "It may not be installed here, or not signed in here, or your computer is not connected.", next: [{ key: "connect_ai", label: "Sign in or pick another AI" }], retryable: false },
  "engine.closing": { message: "The app was closing, so this waits and runs when it opens again.", retryable: true },
  "engine.vault_unreadable": { message: "Your Vault could not be read just now.", next: [{ key: "open_vault", label: "Open the Vault" }], retryable: true },
  "sandbox.unavailable": { message: "This engine cannot run safely on this computer yet.", cause: "Vyre runs Claude Code, Codex and Grok in a sandbox, and this computer has none it can use. An API key works now.", next: [{ key: "connect_ai", label: "Use an API key" }], retryable: false },
  "sandbox.wsl_off": { message: "Claude Code, Codex and Grok need WSL on Windows.", cause: "Vyre runs them in a Linux sandbox, and WSL is off on this computer. Turn it on once (admin and a restart), or use an API key now.", next: [{ key: "turn_on_wsl", label: "Turn on WSL (needs admin and a restart)" }, { key: "connect_ai", label: "Use an API key" }], retryable: false },
  "sandbox.wsl_setup": { message: "The Windows sandbox could not be set up.", cause: "Check the connection, then try again.", retryable: true },
  "sandbox.wsl_start": { message: "The Windows sandbox did not start.", cause: "Try again. If it keeps happening, restart the computer.", retryable: true },
  "sandbox.policy": { message: "The engine was kept out of a folder it may not use.", retryable: true },
  "sandbox.net": { message: "The engine's network guard could not start.", retryable: true },
  "engine.mcp_unavailable": { message: "The engine could not reach Vyre's tools.", retryable: true },
  "engine.cli_failed": { message: "The engine could not start.", cause: "Try again. If it keeps happening, sign in to the account again.", next: [{ key: "connect_ai", label: "Check your AI account" }], retryable: true },
  "engine.cli_error": { message: "The engine stopped with an error before it replied.", retryable: true },
  "engine.mcp_failed": { message: "The engine could not reach Vyre's tools.", retryable: true },
  "engine.step_limit": { message: "The agent took too many steps in one reply, so it was stopped.", cause: "Ask for a smaller part of the work.", retryable: true },
  "engine.busy": { message: "The engine was still answering an earlier message.", retryable: true },
  "engine.closed": { message: "The engine's session had closed.", retryable: true },
  "engine.compact_unsupported": { message: "This engine cannot compact a chat.", retryable: false },
  "engine.nothing_to_compact": { message: "There is nothing to compact yet.", retryable: false },
  "provider.error": { message: "Your AI provider stopped with an error.", retryable: true },
  "provider.filtered": { message: "Your AI provider declined to answer this.", retryable: false },
  "engine.no_first_token": { message: "Your AI didn't answer in time", retryable: true },
  "engine.timeout": { message: "The engine did not answer in time.", retryable: true },
  "engine.session_gone": { message: "The engine lost this chat's earlier session.", cause: "Try again: it starts from the chat's summary.", retryable: true },
  "engine.model_unavailable": { message: "That model cannot run here.", next: [{ key: "pick_model", label: "Choose another model" }, { key: "run_on_my_computer", label: "Run it on my computer" }], retryable: false },
  "engine.no_model_works": { message: "None of your AI accounts can answer right now.", cause: "Check your AI accounts, then try again.", next: [{ key: "connect_ai", label: "Open AI accounts" }], retryable: true },
  "engine.no_account": { message: "Connect your AI to get replies.", cause: "No AI account is saved for this chat yet.", next: [{ key: "connect_ai", label: "Connect your AI" }], retryable: false },
  "engine.account_unavailable": { message: "Your AI account could not be reached just now.", next: [{ key: "connect_ai", label: "Check your AI account" }], retryable: true },
  "engine.account_unsupported": { message: "This engine cannot run on this kind of account yet.", cause: "Use an API key for it.", next: [{ key: "connect_ai", label: "Use an API key" }], retryable: false },
  "engine.unknown_driver": { message: "This chat's AI is not one Vyre knows.", next: [{ key: "connect_ai", label: "Choose another AI" }], retryable: false },
  "provider.auth_failed": { message: "Your AI account needs you to sign in again.", next: [{ key: "connect_ai", label: "Sign in again" }], retryable: false },
  "provider.rate_limited": { message: "Your AI account reached its usage limit.", cause: "Wait for it to reset, or use another account.", next: [{ key: "connect_ai", label: "Use another account" }], retryable: true },
  "provider.unavailable": { message: "Your AI provider is busy or down just now.", retryable: true },
  "provider.overloaded": { message: "Your AI provider is busy just now.", retryable: true },
  "provider.network": { message: "Your AI provider could not be reached.", cause: "Check the connection, then try again.", retryable: true },
  "provider.context_too_long": { message: "This chat is too long for the model.", cause: "Compact the chat, then try again.", retryable: false },
  "provider.bad_request": { message: "Your AI provider refused this request.", retryable: true },
  "provider.bad_response": { message: "Your AI provider sent a reply Vyre could not read.", retryable: true },
  "provider.bad_address": { message: "The address for this AI is not valid.", next: [{ key: "connect_ai", label: "Check your AI account" }], retryable: false },
  "permission.no_grant": { message: "This agent may not use that AI account.", next: [{ key: "connect_ai", label: "Choose another account" }], retryable: false },
  "engine.post_failed": { message: "The reply was written but could not be shown.", cause: "Try again.", retryable: true },
  turn_timeout: { message: "That took too long, so it was stopped.", retryable: true },
  paid_fallback: { message: "This account is out for now.", cause: "A paid key could answer. It is in your Tasks for you to say yes.", retryable: false },
  host_lost: { message: "The server stopped while this was running.", cause: "It may have done part of the work. Check before running it again.", retryable: true },
  agent_paused: { message: "This agent is paused, so it did not answer.", cause: "Resume it from its page, then try again.", retryable: true },
  agent_gone: { message: "This agent was deleted, so it did not answer.", retryable: false },
  no_asker: { message: "No one asked for this, so it did not run.", cause: "An agent's message started it. Ask the agent yourself and it runs for you.", retryable: false },
};

/** A code with no words of its own reads as its family: still what happened, never "did not finish". */
const FAMILY_WORDS: Record<string, { message: string; retryable: boolean }> = {
  sandbox: { message: "The engine's sandbox could not start.", retryable: true },
  provider: { message: "Your AI provider could not answer this one.", retryable: true },
  permission: { message: "This agent was not allowed to do that.", retryable: false },
};
/** The words for a code: its own, else its family's, else the plain fallback (an error Vyre has no code for). */
export function wordsFor(code: string): { message: string; cause?: string; next?: { key: string; label: string }[]; retryable: boolean } {
  return STATUS_WORDS[code] ?? FAMILY_WORDS[code.split(".")[0] ?? ""] ?? { message: "That reply did not finish.", retryable: true };
}
/** The codes with words of their own (status.test.ts checks every code a turn can fail with is here). */
export const KNOWN_CODES: readonly string[] = Object.keys(STATUS_WORDS);

/** How a turn_status block reads: a failed turn is the inline error row with a plain sentence and one action; a stopped or parked turn is a quiet line. */
export type StatusView = { kind: "error"; block: MessageBlock } | { kind: "note"; id: string; text: string } | { kind: "approval"; id: string; taskId: string } | { kind: "wait"; id: string; text: string; action: { key: string; label: string } };

/** The line of a chat that waits for the person's computer (lane l-runson), and its one action. */
export const DEVICE_WAIT_TEXT = "Your computer is off. This chat runs when it is back.";
export const RUN_ON_SERVER = { key: "run_on_server", label: "Run it on the server instead" } as const;

/** Why a turn stopped, in words: never a bare "Stopped." (owner, 4 Nov 2026). */
export function stoppedWords(reason: string): string {
  switch (reason) {
    case "interrupt": return "Stopped because a new message came in while it was working. It answers that one next.";
    case "stop": return "Stopped because Stop was pressed.";
    case "limit": return "Stopped because it reached a spending or turn limit.";
    case "left": return "Stopped because the person it was working for left.";
    case "moved": return "Stopped because the task was handed to someone else.";
    case "closing": return "Waiting: the app was closing. It runs when the app opens again.";
    case "lease": return "Stopped because the server it was running on went away. Send it again.";
    default: return "Stopped, and no reason was recorded. Send it again.";
  }
}

export function statusView(b: MessageBlock): StatusView {
  const d = dataOf(b);
  const state = str(d.state);
  if (state === "note" && str(d.text) !== "") return { kind: "note", id: b.id, text: str(d.text) };
  // a chat pinned to the person's computer waits for it, quietly, with the way to run it on the server instead
  if (state === "device_wait") return { kind: "wait", id: b.id, text: str(d.text) || DEVICE_WAIT_TEXT, action: { ...RUN_ON_SERVER } };
  // files a terminal agent deleted in goal/ went to Vyre's Trash (modules/engine/goal-folder.ts): the line carries Undo, which brings them back
  if (state === "trashed" && str(d.text) !== "" && Array.isArray(d.fileIds)) return { kind: "wait", id: b.id, text: str(d.text), action: { key: `undo_trash:${(d.fileIds as unknown[]).filter((x): x is string => typeof x === "string").join(",")}`, label: "Undo" } };
  // the chat was answered by another account because the person's own sign-in is locked on this server: the one line carries Unlock, which opens the same small sheet as the banner
  if (state === "key_locked" && str(d.text) !== "") return { kind: "wait", id: b.id, text: str(d.text), action: { key: "unlock_vault", label: "Unlock" } };
  // a reply that was ended so Vyre could update (host/src/daemon): one quiet line, and Continue runs that turn again, with the same message, on the same account
  if (state === "stopped_for_update" && str(d.text) !== "") return str(d.turnId) !== "" ? { kind: "wait", id: b.id, text: str(d.text), action: { key: `continue_turn:${str(d.turnId)}`, label: "Continue" } } : { kind: "note", id: b.id, text: str(d.text) };
  if (state === "cancelled") return { kind: "note", id: b.id, text: stoppedWords(str(d.reason)) };
  if (state === "waiting" && str(d.taskId) !== "") return { kind: "approval", id: b.id, taskId: str(d.taskId) };
  if (state === "waiting") return { kind: "note", id: b.id, text: "Waiting for your approval." };
  let w = wordsFor(str(d.code));
  if (str(d.code) === "engine.model_unavailable" && str(d.detail) !== "") w = { ...w, message: str(d.detail) };
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
  // the engine cannot run here: the same plain reasons as the connect card (engine.providers.list), the program is missing or its sign-in needs doing again
  if (str(d.code) === "engine.cli_unusable" && Object.hasOwn(ENGINES, str(d.cli))) {
    const name = ENGINES[str(d.cli)]!.name;
    w = d.cliMissing === true
      ? { message: `${name} is not installed on this computer. Install it, or pick another AI.`, next: [{ key: `install:${str(d.cli)}`, label: `Install ${name}` }, { key: "connect_ai", label: "Pick another AI" }], retryable: false }
      : { message: `Sign in to ${name} again.`, next: [{ key: str(d.account) !== "" ? `sign_in:${str(d.account)}` : "connect_ai", label: "Sign in again" }, { key: "connect_ai", label: "Pick another AI" }], retryable: false };
  }
  // a missing sign-in opens Settings > Your AI at that account, not the generic connect flow
  if ((str(d.code) === "engine.signin_missing" || str(d.code) === "provider.auth_failed") && str(d.account) !== "") w = { ...w, next: [{ key: `sign_in:${str(d.account)}`, label: "Sign in again" }] };
  if (str(d.code) === "engine.vault_unreadable" && str(d.reason) !== "") w = { ...w, cause: `The Vault answered: ${str(d.reason)}.` };
  // the engine process stopped and said nothing a person can use: the sentence never stands alone, the exit code is the reason there is
  if (str(d.code) === "engine.cli_error") w = { ...w, message: "The engine stopped before it replied.", cause: str(d.exit) !== "" ? `It exited with code ${str(d.exit)}. Try again. If it keeps happening, open Details and send them to your admin.` : "It gave no reason. Try again. If it keeps happening, open Details and send them to your admin." };
  return { kind: "error", block: { ...b, type: "error", data: { code: str(d.code), message: w.message, ...(w.cause ? { cause: w.cause } : {}), next: w.next ?? [], retryable: w.retryable, turnId: str(d.turnId), steps: [...(str(d.code) ? [["Code", str(d.code)]] : []), ["Reply", str(d.turnId)]] } } };
}


/** "Olivia's Mac, then the Northwind server": where a turn ran, in order, as its details say it. */
export function ranOnText(ran: ReadonlyArray<{ kind: string; name: string }>): string {
  const word = (r: { kind: string; name: string }): string => (r.kind === "space" && /^the /.test(r.name) ? r.name.charAt(0).toUpperCase() + r.name.slice(1) : r.name);
  return ran.map((r, i) => (i === 0 ? word(r) : r.name)).join(", then ");
}
