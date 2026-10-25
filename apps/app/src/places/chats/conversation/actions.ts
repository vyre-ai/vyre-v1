// What the conversation writes: one capability per action, each through `call` as the signed-in person. Nothing here touches the screen; the components decide what to show while
// a write is out (the message is already on the page before chat.post answers) and what to say when it fails.
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ConversationData } from "./data.tsx";
import { postInput } from "./model.ts";
import type { AgentMode, SendKind, Thread } from "./model.ts";

type Mention = { kind: "person" | "agent"; id: string };

export interface SendResult { messageId: string; threadSeq: number }

/**
 * A send. chat.post goes first, with a key that makes a retry safe. An interrupt then asks the engine to take the new message now (engine.interrupt with its id); a plain send
 * is left in the queue for the agent's next step.
 */
export async function sendMessage(data: ConversationData, input: { text: string; mentions: readonly Mention[]; key: string; kind: SendKind; working: boolean; replyTo?: string }): Promise<SendResult> {
  const out = (await data.call("chat.post", postInput(data.threadId, input.text, input.mentions, input.key, input.replyTo))) as CapMap["chat.post"]["out"];
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
