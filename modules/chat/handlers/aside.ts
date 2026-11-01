// /btw (rc.9, "an aside"): a question asked while an agent works. It runs as its own short turn in a hidden thread of the asker's, on the asker's own account, with what the chat knows (the summary, the recent
// messages, what the agent is writing right now) written into its first message, and in plan mode so it can only read. Nothing is written into the chat it came from: the running turn is not touched and the
// agent working there never sees the aside, unless the person keeps the answer (chat.aside_keep), which posts it as one card.
import { addAgent, addMember, agentsOf, askerOf, ensure, insertThread, insertMessage, raise, threadBy } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";
import { load } from "./g24a.ts";
import { deliver } from "./post.ts";
import { postLinkCard } from "./link-card.ts";

const MAX_QUESTION = 2000;
const RECENT = 12;
const LINE = 400;
const SUMMARY = 1500;
const LIVE = 1200;

const flat = (s: string, n: number): string => { const one = s.replace(/\s+/g, " ").trim(); return one.length > n ? `${one.slice(0, n - 3)}...` : one; };

type Call = NonNullable<ChatCtx["call"]>;

/** What the chat knows right now, as plain lines: all of it read the way the asker reads it (a private chat answers only to its people). */
async function contextOf(ctx: ChatCtx, call: Call, threadId: string, asker: string): Promise<string> {
  const parts: string[] = [];
  try {
    const s = (await call("chat.transcript.summary", { threadId })) as { summary?: string };
    if (s.summary && s.summary.trim() !== "") parts.push(`What the chat has covered so far:\n${flat(s.summary, SUMMARY)}`);
  } catch { /* no summary yet */ }
  try {
    const r = (await call("chat.messages.list", { threadId, limit: RECENT })) as { messages?: Array<{ author: { kind: string; id: string }; kind: string; body: string }> };
    const lines = (r.messages ?? []).filter((m) => (m.kind === "text" || m.kind === "agent") && m.body.trim() !== "")
      .map((m) => `- ${m.author.id === asker ? "You" : m.author.kind === "agent" ? "The agent" : "Someone"}: ${flat(m.body, LINE)}`);
    if (lines.length > 0) parts.push(`The latest messages, oldest first:\n${lines.join("\n")}`);
  } catch { /* unreadable: the question stands alone */ }
  try {
    const live = (await call("engine.live_turns", { threadId })) as { turns?: Array<{ text: string }> };
    const now = (live.turns ?? []).map((t) => t.text.trim()).filter((t) => t !== "").join("\n");
    if (now !== "") parts.push(`What the agent is writing right now (not finished):\n${flat(now, LIVE)}`);
    else if ((live.turns ?? []).length > 0) parts.push("The agent is working on its next step and has written nothing yet.");
  } catch { /* nothing running */ }
  return parts.join("\n\n");
}

export async function aside(ctx: ChatCtx, input: { threadId: string; question: string; idempotencyKey: string }) {
  ensure(ctx.db);
  const parent = load(ctx, input.threadId);
  if (parent.kind === "helper" || parent.scopeType === "aside") raise(ctx, "validation.bad_input", "An aside is asked from the chat itself.");
  const question = input.question.trim();
  if (question === "") raise(ctx, "validation.bad_input", "Say what to ask.");
  if (question.length > MAX_QUESTION) raise(ctx, "validation.bad_input", `A side question can be at most ${MAX_QUESTION} characters.`);
  if (!ctx.call) raise(ctx, "internal.unavailable", "The aside is not available just now.");
  const asker = askerOf(ctx);
  if (ctx.principal.kind !== "person" || !asker.startsWith("usr_")) raise(ctx, "validation.bad_input", "An aside is asked by a person.");
  const lead = agentsOf(ctx.db, parent.id).find((a) => a.mode === "lead") ?? agentsOf(ctx.db, parent.id)[0];
  if (!lead) raise(ctx, "validation.bad_input", "There is no agent in this chat to ask.");
  const known = await contextOf(ctx, ctx.call, parent.id, asker);
  const prompt = [
    "A side question, asked while you may be busy with something else. It is not part of the conversation and nothing you say here goes into it. Answer it briefly, in a few sentences, from what you know and from the context below.",
    "You can only read: change nothing, do not start work and do not propose a plan.",
    ...(known !== "" ? ["", known] : []),
    "", `The question: ${question}`,
  ].join("\n");
  const thread = insertThread(ctx, { kind: "chat", title: `Aside: ${flat(question, 60)}`, starter: asker, scopeType: "aside", scopeId: parent.id, listed: false, mode: "plan" });
  addMember(ctx, thread.id, asker, "owner");
  addAgent(ctx, thread.id, { agentId: lead.agentId, mode: "lead", ...(lead.model !== undefined ? { model: lead.model } : {}), addedBy: asker });
  const first = insertMessage(ctx, thread.id, { author: asker, kind: "text", body: prompt });
  ctx.emit("thread.started", thread.id, { threadId: thread.id, kind: "chat", starter: asker, scopeType: "aside", scopeId: parent.id });
  deliver(ctx, thread, first, [], { kind: "person", id: asker }, { notify: false });
  return { asideThreadId: thread.id, messageId: first.id };
}

/** Keep an aside's answer: one card in the chat it came from, from the asker, so the others (and the agent working there) can read it. */
export async function asideKeep(ctx: ChatCtx, input: { asideThreadId: string; idempotencyKey: string }) {
  ensure(ctx.db);
  const a = load(ctx, input.asideThreadId);
  if (a.scopeType !== "aside" || a.scopeId === undefined) raise(ctx, "validation.bad_input", "That is not an aside.");
  const parent = threadBy(ctx.db, a.scopeId);
  if (!parent) raise(ctx, "validation.not_found", "The chat this aside came from is gone.");
  load(ctx, parent.id);
  if (!ctx.call) raise(ctx, "internal.unavailable", "The aside is not available just now.");
  const r = (await ctx.call("chat.messages.list", { threadId: a.id, limit: 20 })) as { messages?: Array<{ author: { kind: string }; kind: string; body: string }> };
  const msgs = r.messages ?? [];
  const answer = [...msgs].reverse().find((m) => m.author.kind === "agent" && m.body.trim() !== "")?.body.trim();
  if (!answer) raise(ctx, "validation.precondition_failed", "There is no answer to keep yet.");
  const asked = (msgs.find((m) => m.author.kind !== "agent")?.body ?? "").split("The question: ").pop()?.trim() ?? "";
  const card = postLinkCard(ctx, parent.id, { icon: "thread", lead: "Aside", by: askerOf(ctx), title: flat(asked || "A side question", 120), body: answer.slice(0, 2000) }, `Aside: ${flat(asked, 80)}`);
  return { messageId: card.id };
}
