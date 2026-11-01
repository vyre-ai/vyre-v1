// What the conversation writes: one capability per action, each through `call` as the signed-in person. Nothing here touches the screen; the components decide what to show while
// a write is out (the message is already on the page before chat.post answers) and what to say when it fails.
import { installCommand } from "./status.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ConversationData } from "./data.tsx";
import { exportAs } from "./export.ts";
import type { ExportFormat } from "./export.ts";
import { mentionsIn, postInput } from "./model.ts";
import { carriesScreen, currentScreen } from "../../../shell/ask/screen.ts";
import type { AgentMode, Message, SendKind, Thread } from "./model.ts";

type Mention = { kind: "person" | "agent"; id: string };

export interface SendResult { messageId: string; threadSeq: number }

/** A thing linked from the text or a chip: sent with the message so the reader (and the agent) get the id, not only the title. */
export interface Ref { kind: string; id: string; title: string }

/** A file to send with a message: the browser File behind the tray chip. */
export interface Upload { name: string; file?: unknown; size?: number; mime?: string }

/** The block that carries the links of a message. */
export const REFS_BLOCK = "refs";

/**
 * A send. chat.post goes first, with a key that makes a retry safe. An interrupt then asks the engine to take the new message now (engine.interrupt with its id); a plain send
 * is left in the queue for the agent's next step.
 */
export async function sendMessage(data: ConversationData, input: { text: string; mentions: readonly Mention[]; key: string; kind: SendKind; working: boolean; replyTo?: string; refs?: readonly Ref[]; attachments?: readonly string[] }): Promise<SendResult> {
  const post = postInput(data.threadId, input.text, input.mentions, input.key, input.replyTo);
  if (input.attachments && input.attachments.length > 0) post.attachments = [...input.attachments];
  if (input.refs && input.refs.length > 0) post.blocks = [{ type: REFS_BLOCK, v: 1, data: { refs: input.refs.map((r) => ({ kind: r.kind, id: r.id, title: r.title })) } }];
  // An Ask pane is about a place: its messages carry where the person is, so "this" means the object on screen.
  const screen = carriesScreen(data.threadId) ? currentScreen() : null;
  const out = (await data.call("chat.post", { ...post, ...(screen ? { screen } : {}) })) as CapMap["chat.post"]["out"];
  if (input.kind === "interrupt" && input.working) await data.call("engine.interrupt", { threadId: data.threadId, messageId: out.message.messageId } satisfies CapMap["engine.interrupt"]["in"]);
  return { messageId: out.message.messageId, threadSeq: out.message.threadSeq };
}

/** Stop one agent's work, or every agent's in the thread. The steps so far are kept. */
export async function stopAgent(data: ConversationData, agentId?: string): Promise<void> {
  await data.call("engine.stop", { threadId: data.threadId, ...(agentId === undefined ? {} : { agentId }) } satisfies CapMap["engine.stop"]["in"]);
}

export async function stopAll(data: ConversationData): Promise<void> {
  await data.call("engine.stop_all", { threadId: data.threadId } satisfies CapMap["engine.stop_all"]["in"]);
}

/** Leads or Listening for one agent. The engine keeps one lead per thread: making another agent lead turns the old lead into a listener and says which. */
export async function setMode(data: ConversationData, agentId: string, mode: AgentMode): Promise<CapMap["engine.set_mode"]["out"]> {
  return (await data.call("engine.set_mode", { threadId: data.threadId, agentId, mode } satisfies CapMap["engine.set_mode"]["in"])) as CapMap["engine.set_mode"]["out"];
}

export async function addAgent(data: ConversationData, agentId: string): Promise<void> {
  await data.call("threads.add_agent", { threadId: data.threadId, agentId, mode: "listen" } satisfies CapMap["threads.add_agent"]["in"]);
}

export async function removeAgent(data: ConversationData, agentId: string): Promise<void> {
  await data.call("threads.remove_agent", { threadId: data.threadId, agentId } satisfies CapMap["threads.remove_agent"]["in"]);
}

/** "Ask Docs to review this": an @mention in the thread, so Docs answers even while it only listens. */
export async function askToReview(data: ConversationData, thread: Thread, agentId: string, key: string): Promise<SendResult> {
  const name = data.nameOf(agentId);
  return sendMessage(data, { text: `@${name} review this ${thread.kind === "channel" ? "channel" : "thread"}`, mentions: [{ kind: "agent", id: agentId }], key, kind: "queue", working: false });
}

export async function editMessage(data: ConversationData, messageId: string, body: string): Promise<void> {
  await data.call("chat.edit", { threadId: data.threadId, messageId, body } satisfies CapMap["chat.edit"]["in"]);
}

export async function react(data: ConversationData, messageId: string, emoji: string, remove: boolean): Promise<void> {
  await data.call("chat.react", { threadId: data.threadId, messageId, emoji, ...(remove ? { remove: true } : {}) } satisfies CapMap["chat.react"]["in"]);
}

export async function setPinned(data: ConversationData, messageId: string, pinned: boolean): Promise<void> {
  await data.call(pinned ? "chat.pin" : "chat.unpin", { threadId: data.threadId, messageId });
}

export async function deleteMessage(data: ConversationData, messageId: string): Promise<void> {
  await data.call("chat.delete_message", { threadId: data.threadId, messageId } satisfies CapMap["chat.delete_message"]["in"]);
}

/** Replies under a message: the message's own thread (one session underneath). */
export async function openMessageThread(data: ConversationData, messageId: string): Promise<string> {
  const out = (await data.call("chat.thread", { threadId: data.threadId, messageId } satisfies CapMap["chat.thread"]["in"])) as CapMap["chat.thread"]["out"];
  return out.thread.threadId;
}

export async function answerBlock(data: ConversationData, blockId: string, answer: unknown): Promise<void> {
  await data.call("chat.answer_block", { threadId: data.threadId, blockId, answer } satisfies CapMap["chat.answer_block"]["in"]);
}

export async function approvePlan(data: ConversationData, planId: string): Promise<void> {
  await data.call("chat.approve_plan", { threadId: data.threadId, planId } satisfies CapMap["chat.approve_plan"]["in"]);
}

export async function setPlanMode(data: ConversationData, planMode: boolean): Promise<void> {
  await data.call("threads.set_plan_mode", { threadId: data.threadId, planMode } satisfies CapMap["threads.set_plan_mode"]["in"]);
}

export async function retryTurn(data: ConversationData, turnId: string): Promise<void> {
  await data.call("engine.turn.retry", { turnId } satisfies CapMap["engine.turn.retry"]["in"]);
}

/**
 * What a button on a failed reply does. Connect and Open the Vault go to the Vault page; Install copies the exact command; Unlock asks for the password in place and, once the key is open, sends the
 * reply that stopped again (one retry of that turn: the message is not posted twice). Anything else points to the model switcher.
 */
export async function errorAction(data: ConversationData, key: string, turnId: string | undefined, say: (text: string) => void): Promise<void> {
  if (key === "connect_ai" || key === "open_vault") { if (data.nav.openAiSetup) data.nav.openAiSetup(); else say("Open the Vault and add an AI account."); return; }
  const command = installCommand(key);
  if (command) { data.copy(command); say(`Copied: ${command}. Run it in a terminal, then try again.`); return; }
  if (key === "unlock_vault") {
    if (!data.nav.unlockVault) { say("Unlock your Vault from the Vault page, then try again."); return; }
    if ((await data.nav.unlockVault()) && turnId) await retryTurn(data, turnId);
    return;
  }
  say(`Choose ${key} in the model switcher or ask for access.`);
}

/** True when the person has an AI account that works (a connected, signed-in one): what "Connect your AI" is waiting for. */
export async function hasWorkingAccount(data: ConversationData): Promise<boolean> {
  const out = (await data.call("engine.accounts.list", {})) as CapMap["engine.accounts.list"]["out"];
  return out.accounts.some((a) => a.status === "ok");
}

/** A private chat never gains people: @mentioning a person offers "Start a channel with them", a new channel linked back. */
export async function startChannel(data: ConversationData, personId: string, key: string): Promise<void> {
  await data.call("threads.make_channel", { threadId: data.threadId, personId, idempotencyKey: key } satisfies CapMap["threads.make_channel"]["in"]);
}

export interface ModelChoice { provider: string; model: string; title: string; allowed: boolean }

/** The models this thread may use (the Space's policy and the asker's accounts decide which are allowed). */
export async function listModels(data: ConversationData): Promise<ModelChoice[]> {
  const out = (await data.call("engine.models.list", { threadId: data.threadId } satisfies CapMap["engine.models.list"]["in"])) as CapMap["engine.models.list"]["out"];
  return out.models.map((m) => ({ provider: m.provider, model: m.model, title: m.title, allowed: m.allowed }));
}

/** Switches the model the lead answers with. The engine writes the switch into the chat as a quiet line. */
export async function setModel(data: ConversationData, agentId: string, choice: ModelChoice): Promise<void> {
  await data.call("engine.set_model", { threadId: data.threadId, agentId, provider: choice.provider, model: choice.model } satisfies CapMap["engine.set_model"]["in"]);
}

/* ---------- files that go with a message ---------- */

/** Most bytes sent inline in one call; a bigger file goes through the one-time upload address. */
export const INLINE_LIMIT = 3 * 1024 * 1024;

export function toBase64(bytes: Uint8Array): string {
  let out = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) out += String.fromCharCode(...bytes.subarray(i, i + step));
  return (globalThis as { btoa?: (s: string) => string }).btoa?.(out) ?? Buffer.from(bytes).toString("base64");
}

interface BlobLike { arrayBuffer(): Promise<ArrayBuffer>; size?: number; type?: string }
const isBlob = (v: unknown): v is BlobLike => typeof v === "object" && v !== null && typeof (v as BlobLike).arrayBuffer === "function";

/** The folder chat uploads go to: "Chat uploads" in the person's Personal folder, made the first time. */
export async function uploadFolder(data: ConversationData): Promise<string> {
  const tree = (await data.call("files.tree", {})) as CapMap["files.tree"]["out"];
  const root = tree.roots.find((r) => r.key === "personal" && r.folderId);
  if (!root?.folderId) throw new Error("No place to keep the file");
  const list = (await data.call("files.list", { section: "personal", folder: root.folderId })) as CapMap["files.list"]["out"];
  const have = list.folders.find((f) => f.name === "Chat uploads");
  if (have) return have.folderId;
  const made = (await data.call("files.folder.create", { parentId: root.folderId, name: "Chat uploads", idempotencyKey: `chat-uploads:${root.folderId}` })) as CapMap["files.folder.create"]["out"];
  return made.folder.folderId;
}

const withSuffix = (name: string, n: number): string => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
};

/** Store each file in Files and return their ids, in order. A name already taken in the folder gets (2), (3). Nothing is sent if one cannot be read. */
export async function uploadAttachments(data: ConversationData, files: readonly Upload[], key: string): Promise<string[]> {
  if (files.length === 0) return [];
  return storeFiles(data, await uploadFolder(data), files, key);
}

/** Store each file in a folder and return their ids, in order (the same rules as an attachment: inline up to INLINE_LIMIT, else through the upload address; a taken name gets (2), (3)). */
export async function storeFiles(data: Pick<ConversationData, "call" | "putBlob">, folderId: string, files: readonly Upload[], key: string): Promise<string[]> {
  const ids: string[] = [];
  for (const [i, f] of files.entries()) {
    if (!isBlob(f.file)) throw new Error(`${f.name} cannot be read`);
    const bytes = new Uint8Array(await f.file.arrayBuffer());
    const mime = f.mime || f.file.type || "application/octet-stream";
    let content: { base64: string } | { blobId: string };
    if (bytes.length <= INLINE_LIMIT) content = { base64: toBase64(bytes) };
    else {
      if (!data.putBlob) throw new Error(`${f.name} is too large to send here`);
      const slot = (await data.call("files.upload_url", { size: bytes.length, mime })) as CapMap["files.upload_url"]["out"];
      await data.putBlob(slot.url, bytes);
      content = { blobId: slot.blobId };
    }
    let made: CapMap["files.create"]["out"] | undefined;
    for (let n = 1; n <= 20 && !made; n++) {
      try {
        made = (await data.call("files.create", { folderId, name: n === 1 ? f.name : withSuffix(f.name, n), content, mime, idempotencyKey: `${key}:${i}:${n}` })) as CapMap["files.create"]["out"];
      } catch (e) {
        if (!/duplicate/.test(JSON.stringify(e) + String((e as { code?: unknown })?.code ?? ""))) throw e;
      }
    }
    if (!made) throw new Error(`${f.name} could not be saved`);
    ids.push(made.file.fileId);
  }
  return ids;
}

/* ---------- commands and message actions that cross threads ---------- */

/** Branch the chat at a message. Returns the new chat's id. */
export async function forkChat(data: ConversationData, messageId: string | undefined, key: string): Promise<string> {
  const out = (await data.call("chat.fork", { threadId: data.threadId, ...(messageId ? { messageId } : {}), idempotencyKey: key })) as CapMap["chat.fork"]["out"];
  return out.thread.threadId;
}

/** A task from a message: the task's title is the first line (or the words given), its summary the whole message, and a block links back to the message. */
export async function makeTask(data: ConversationData, thread: Thread, message: Pick<Message, "messageId" | "body" | "author" | "createdAt">, key: string, title?: string): Promise<string> {
  // a real message: the server makes the task, points it back at the message and leaves the "Task created" card in the thread. The first person @named in the message gets it (a name in the chat
  // directory, not the asker), else the asker does.
  if (message.messageId !== "") {
    const named = mentionsIn(message.body, data.directory.filter((c) => c.id !== data.me.id && (c.kind === "person" || thread.agents.some((x) => x.agentId === c.id))))[0];
    const out = (await data.call("chat.make_task", {
      threadId: thread.threadId, messageId: message.messageId, ...(title?.trim() ? { title: title.trim() } : {}), ...(named ? { assigneeId: named.id } : {}), idempotencyKey: key,
    } as CapMap["chat.make_task"]["in"])) as CapMap["chat.make_task"]["out"];
    return out.taskId;
  }
  const firstLine = message.body.trim().split(/\n/)[0] ?? "";
  const name = (title?.trim() || firstLine || "Follow up on this message").slice(0, 120);
  const out = (await data.call("tasks.create", {
    title: name, summary: message.body.slice(0, 4000), assigned: { kind: "person", id: data.me.id }, source: { kind: "chat", id: thread.threadId },
    blocks: [{ type: "chat_message", v: 1, data: { threadId: thread.threadId, messageId: message.messageId, author: data.nameOf(message.author.id), title: name } }],
    idempotencyKey: key,
  } as CapMap["tasks.create"]["in"])) as CapMap["tasks.create"]["out"];
  return out.task.id;
}

export async function startHelper(data: ConversationData, thread: Thread, instruction: string, agentId?: string): Promise<string> {
  const title = instruction.trim().split(/\n/)[0]!.slice(0, 60);
  const out = (await data.call("chat.helper.start", { threadId: thread.threadId, title, instruction: instruction.trim(), ...(agentId ? { agentId } : {}) } as CapMap["chat.helper.start"]["in"])) as CapMap["chat.helper.start"]["out"];
  return out.helper.threadId;
}

export async function handOff(data: ConversationData, thread: Thread, toAgentId: string, note: string): Promise<string> {
  const out = (await data.call("chat.handoff", { threadId: thread.threadId, toAgentId, note } as CapMap["chat.handoff"]["in"])) as CapMap["chat.handoff"]["out"];
  return out.thread.threadId;
}

/** Keep a fact in the memory this agent holds of the person. */
export async function remember(data: ConversationData, thread: Thread, agentId: string, text: string): Promise<boolean> {
  const out = (await data.call("memory.propose_fact", { text: text.trim(), agentId, layer: "person", sourceKind: "chat", sourceRef: thread.threadId, threadId: thread.threadId } as CapMap["memory.propose_fact"]["in"])) as CapMap["memory.propose_fact"]["out"];
  return out.merged;
}

const EXPORT_PAGE = 200;
const EXPORT_MAX = 20_000;

/** Every message the person can read, oldest first, a page at a time. */
export async function allMessages(data: ConversationData): Promise<Message[]> {
  const out: Message[] = [];
  let before: number | undefined;
  while (out.length < EXPORT_MAX) {
    const page = (await data.call("chat.messages.list", { threadId: data.threadId, limit: EXPORT_PAGE, ...(before !== undefined ? { before } : {}) })) as CapMap["chat.messages.list"]["out"];
    out.unshift(...page.messages);
    const first = page.messages[0];
    if (!page.hasMore || !first) break;
    before = first.threadSeq;
  }
  return out;
}

/** Build the export file for this chat in a format. Names of attached files are looked up once each; a file the person cannot open is called "File". */
export async function exportChat(data: ConversationData, thread: Thread, format: ExportFormat): Promise<{ name: string; mime: string; content: string; messages: number }> {
  const messages = await allMessages(data);
  const names = new Map<string, string>();
  for (const id of new Set(messages.flatMap((m) => m.attachments))) {
    try { names.set(id, ((await data.call("files.get", { fileId: id })) as CapMap["files.get"]["out"]).file.name); } catch { names.set(id, "File"); }
  }
  const file = exportAs(format, { thread, messages, nameOf: data.nameOf, fileName: (id) => names.get(id) ?? "File", clock: data.clock() });
  return { ...file, messages: messages.length };
}

/** Most characters of the old chat that go into the new one: the end of it, which is what the work is about now. */
export const CONTINUE_LIMIT = 60_000;

export const OTHERS_LINE = "This chat has other people in it, so it can't be copied to another Space.";

/** A chat may be copied to another Space only when the signed-in person is the only human in it. Agents' words are fine. */
export function onlyMeHere(thread: Pick<Thread, "kind" | "members" | "channelId">, meId: string): boolean {
  return thread.kind !== "channel" && thread.channelId === undefined && thread.members.every((m) => m.kind !== "person" || m.id === meId);
}

/**
 * Continue this chat in another Space the person belongs to. A new chat starts there with that Space's assistant; its first message says where it came from and carries the conversation so far as
 * words (a copy, not new instructions). Nothing in the old chat changes. Returns the new chat's id in that Space.
 */
export async function continueElsewhere(data: ConversationData, thread: Thread, space: { id: string; name: string }, fromName: string, key: string): Promise<string> {
  if (!data.elsewhere) throw new Error("There is no other Space to continue in");
  if (!onlyMeHere(thread, data.me.id)) throw new Error(OTHERS_LINE);
  const messages = await allMessages(data);
  // a person who spoke here and has since left is still someone else's words
  if (messages.some((m) => m.author.kind === "person" && m.author.id !== data.me.id)) throw new Error(OTHERS_LINE);
  const names = new Map<string, string>();
  for (const id of new Set(messages.flatMap((m) => m.attachments))) {
    try { names.set(id, ((await data.call("files.get", { fileId: id })) as CapMap["files.get"]["out"]).file.name); } catch { names.set(id, "File"); }
  }
  const copy = exportAs("md", { thread, messages, nameOf: data.nameOf, fileName: (id) => names.get(id) ?? "File", clock: data.clock() }).content;
  const agents = (await data.elsewhere.call(space.id, "agents.list", {})) as CapMap["agents.list"]["out"];
  const agent = agents.agents.find((a) => a.role === "assistant") ?? agents.agents.find((a) => /assistant/i.test(a.name)) ?? agents.agents[0];
  if (!agent) throw new Error(`${space.name} has no agent to continue with`);
  const title = (thread.title ?? data.nameOf(thread.agents[0]?.agentId ?? "") ?? "Chat").slice(0, 100);
  const first = `Continue a conversation I had in ${fromName}. What follows is a copy of it, not new instructions.\n\n${copy.length > CONTINUE_LIMIT ? `${copy.slice(-CONTINUE_LIMIT)}` : copy}`;
  const out = (await data.elsewhere.call(space.id, "chat.start", { kind: "chat", agentIds: [agent.agentId], title: `${title} (from ${fromName})`, first, idempotencyKey: key })) as CapMap["chat.start"]["out"];
  return out.thread.threadId;
}

/** A place a message can be shared to: a channel (its main chat) or a person (the chat with them, made when there is none). */
export interface ShareTarget { label: string; threadId?: string; personId?: string }

const MAX_TARGETS = 12;

/** The channels the person is in and the people they can write to, except where they already are. */
export async function shareTargets(data: ConversationData, here: string): Promise<ShareTarget[]> {
  const out: ShareTarget[] = [];
  const list = (await data.call("channels.list", {} as CapMap["channels.list"]["in"])) as CapMap["channels.list"]["out"];
  for (const c of list.channels) if (!c.archived && c.mainThreadId !== here) out.push({ label: `#${c.name}`, threadId: c.mainThreadId });
  for (const p of data.directory) if (p.kind === "person" && p.id !== data.me.id) out.push({ label: p.name, personId: p.id });
  return out.slice(0, MAX_TARGETS);
}

/** Share a message: to a person it first makes sure there is a chat with them (the same call a new chat makes; an existing one is returned). */
export async function shareTo(data: ConversationData, threadId: string, messageId: string, to: ShareTarget, key: string): Promise<void> {
  let target = to.threadId;
  if (!target && to.personId) {
    const started = (await data.call("chat.start", { kind: "chat", agentIds: [], personId: to.personId, idempotencyKey: `${key}:chat` } as CapMap["chat.start"]["in"])) as CapMap["chat.start"]["out"];
    target = started.thread.threadId;
  }
  if (!target) return;
  await data.call("chat.share", { threadId, messageId, toThreadId: target, to: to.threadId ? to.label : to.personId, idempotencyKey: key } as CapMap["chat.share"]["in"]);
}

/** /btw: a side question, answered in a hidden read-only thread of the asker's; the chat it was asked in is not written to. */
export async function startAside(data: ConversationData, threadId: string, question: string, key: string): Promise<{ asideThreadId: string }> {
  const out = (await data.call("chat.aside", { threadId, question, idempotencyKey: key } as CapMap["chat.aside"]["in"])) as CapMap["chat.aside"]["out"];
  return { asideThreadId: out.asideThreadId };
}

/** Keep an aside's answer: one card in the chat it came from. */
export async function keepAside(data: ConversationData, asideThreadId: string, key: string): Promise<void> {
  await data.call("chat.aside_keep", { asideThreadId, idempotencyKey: key } as CapMap["chat.aside_keep"]["in"]);
}

/** Dismiss an aside: its thread is put away (best effort: the card is gone either way). */
export async function dismissAside(data: ConversationData, asideThreadId: string): Promise<void> {
  await data.call("threads.delete", { threadId: asideThreadId } as CapMap["threads.delete"]["in"]).catch(() => undefined);
}

/** Send a queued message now: the running turn is cut and the message goes first (the same call as the composer's Now). */
/** Hand a queued message to the agent now without stopping it: it reads it at its next step. False when the message was not waiting any more. */
export async function steerQueued(data: ConversationData, threadId: string, messageId: string): Promise<boolean> {
  return ((await data.call("engine.steer", { threadId, messageId } as CapMap["engine.steer"]["in"])) as CapMap["engine.steer"]["out"]).steered;
}

/** Engines that cannot take a message mid-turn: Steer is not offered for them, the message stays queued until the turn ends. */
export const CANNOT_STEER = new Set(["codex", "grok"]);

export async function sendQueuedNow(data: ConversationData, threadId: string, messageId: string): Promise<void> {
  await data.call("engine.interrupt", { threadId, messageId } as CapMap["engine.interrupt"]["in"]);
}

/** Take a queued message back to edit it: it leaves the queue and the chat, and its words are returned for the composer. False when its turn had already started. */
export async function takeBackQueued(data: ConversationData, threadId: string, messageId: string): Promise<boolean> {
  const out = (await data.call("engine.drop_queued", { threadId, messageId } as CapMap["engine.drop_queued"]["in"])) as CapMap["engine.drop_queued"]["out"];
  if (!out.dropped) return false;
  await data.call("chat.delete_message", { threadId, messageId } as CapMap["chat.delete_message"]["in"]).catch(() => undefined);
  return true;
}
