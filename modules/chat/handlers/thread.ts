// Threads, channels and waiting blocks (spec 2.5, 3.2, 4.6; ARCH 6.1, 7.2).
//   chat.start                   a chat, an Ask pane, a direct message, or (scopeType 'run') the one thread of a Run, shown as a line in the subject record's channel
//   chat.thread                  the inline thread under a message
//   threads.make_channel         a private chat becomes a channel with another person, linked back to the chat
//   channels.create              a named room, public to the Team Space or invite-only; a record's channel is a Project or Journey channel
//   channels.connect_outside_agent   the MCP address, a one-time token (shown once, 10 minutes) and the run command for Claude Code or Codex
//   chat.answer_block / chat.approve_plan   answers to the blocks that park a turn; the engine reads block.answered and queues the wake
import {
  MAX_NAME, addAgent, addMember, agentsOf, askerOf, blockBy, channelBy, channelByName, channelOfRecord, channelOut, ensure, insertChannel, insertMessage, insertThread, membersOf, messageBy,
  mintId, patchBlockInMessage, planBy, raise, threadBy, threadOut,
} from "../projections.ts";
import type { ChatCtx, Mode, PlanStep, ThreadRec } from "../projections.ts";
import { canSpeak, deliver, isDirect } from "./post.ts";

type Row = Record<string, unknown>;
const MAX_AGENTS = 20;

function uniqueIds(ctx: ChatCtx, ids: string[] | undefined, prefix: string, what: string): string[] {
  const out: string[] = [];
  for (const id of ids ?? []) {
    if (!id.startsWith(prefix)) raise(ctx, "validation.bad_input", `That is not ${what}.`, { id });
    if (!out.includes(id)) out.push(id);
  }
  if (out.length > MAX_AGENTS && prefix === "agt_") raise(ctx, "validation.bad_input", `A chat can have at most ${MAX_AGENTS} agents.`);
  return out;
}

/** Channel names are plain words people type after a #: trimmed, spaces collapsed, no leading #. */
function cleanName(ctx: ChatCtx, raw: string): string {
  const name = raw.trim().replace(/^#+/, "").trim().replace(/\s+/g, " ");
  if (name === "") raise(ctx, "validation.bad_input", "Give the channel a name.");
  if (name.length > MAX_NAME) raise(ctx, "validation.bad_input", `A channel name can be at most ${MAX_NAME} characters.`);
  return name;
}

function emitAgentsEngaged(ctx: ChatCtx, threadId: string, agents: Array<{ agentId: string; mode: Mode }>, by: string): void {
  for (const a of agents) ctx.emit("agent.engaged", threadId, { threadId, agentId: a.agentId, mode: a.mode, by });
}

function emitStarted(ctx: ChatCtx, t: ThreadRec): void {
  ctx.emit("thread.started", t.id, {
    threadId: t.id, kind: t.kind, starter: t.starter ?? ctx.principal.id,
    ...(t.parentThreadId !== undefined ? { parentThreadId: t.parentThreadId } : {}), ...(t.channelId !== undefined ? { channelId: t.channelId } : {}),
    ...(t.scopeType !== undefined ? { scopeType: t.scopeType } : {}), ...(t.scopeId !== undefined ? { scopeId: t.scopeId } : {}),
  });
}

/** A direct message between the same two people is one conversation: starting it again opens it. */
function directBetween(ctx: ChatCtx, a: string, b: string): ThreadRec | null {
  const rows = ctx.db.all(
    `SELECT t.id AS id FROM chat_thread t
      WHERE t.kind = 'chat' AND t.channelId IS NULL AND t.scopeType IS NULL AND t.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM chat_thread_member m WHERE m.thread = t.id AND m.principal = ? AND m.deleted_at IS NULL)
        AND EXISTS (SELECT 1 FROM chat_thread_member m WHERE m.thread = t.id AND m.principal = ? AND m.deleted_at IS NULL)
      ORDER BY t.createdAt LIMIT 20`, a, b,
  ) as Row[];
  for (const r of rows) {
    const t = threadBy(ctx.db, String(r["id"]));
    if (t && isDirect(ctx, t)) return t;
  }
  return null;
}

export interface StartInput {
  kind: "chat" | "ask"; agentIds: string[]; personId?: string; title?: string; scopeType?: string; scopeId?: string; folderId?: string; recordId?: string; model?: string; provider?: string;
  effort?: string; first?: string; idempotencyKey?: string;
}

/** The first message of a new thread, from the caller. */
function postFirst(ctx: ChatCtx, t: ThreadRec, body: string | undefined): void {
  if (body === undefined || body.trim() === "") return;
  const m = insertMessage(ctx, t.id, { author: ctx.principal.id, kind: ctx.principal.kind === "agent" ? "agent" : "text", body });
  deliver(ctx, t, m, [], { kind: ctx.principal.kind, id: ctx.principal.id }, { notify: false });
}

export async function start(ctx: ChatCtx, input: StartInput) {
  ensure(ctx.db);
  const asker = askerOf(ctx);
  const agentIds = uniqueIds(ctx, input.agentIds, "agt_", "an agent");
  const personId = input.personId;
  if (personId !== undefined) {
    if (!personId.startsWith("usr_")) raise(ctx, "validation.bad_input", "That is not a person.", { id: personId });
    if (personId === asker) raise(ctx, "validation.bad_input", "You cannot start a chat with yourself.");
  }
  if ((input.scopeType === undefined) !== (input.scopeId === undefined)) raise(ctx, "validation.bad_input", "Name the object with both scopeType and scopeId.");
  const isRun = input.scopeType === "run";

  if (input.kind === "ask") {
    if (isRun) raise(ctx, "validation.bad_input", "A Run has a chat, not an Ask pane.");
    if (input.scopeType === undefined) raise(ctx, "validation.bad_input", "An Ask pane is about something: say which record, file, event or page.");
    if (personId !== undefined) raise(ctx, "validation.bad_input", "An Ask pane is private. Start a chat to talk to a person.");
    if (agentIds.length === 0) raise(ctx, "validation.bad_input", "Pick the agent to ask.");
  } else if (agentIds.length === 0 && personId === undefined) {
    raise(ctx, "validation.bad_input", "Pick an agent or a person to talk to.");
  }
  if (isRun) {
    if (!input.scopeId!.startsWith("run_")) raise(ctx, "validation.bad_input", "A Run thread is named by its Run id.", { scopeId: input.scopeId });
    if (personId !== undefined) raise(ctx, "validation.bad_input", "A Run chat belongs to the Run, not to a pair of people.");
  }

  // One chat per Run: starting it again opens the one that exists.
  if (isRun) {
    const row = (ctx.db.all("SELECT id FROM chat_thread WHERE kind = 'run' AND scopeId = ? AND deleted_at IS NULL", input.scopeId) as Row[])[0];
    if (row) { const t = threadBy(ctx.db, String(row["id"]))!; return { thread: threadOut(ctx.db, t) }; }
  }
  // The same two people have one direct message.
  if (personId !== undefined && agentIds.length === 0 && input.scopeType === undefined) {
    const dm = directBetween(ctx, asker, personId);
    if (dm) { postFirst(ctx, dm, input.first); return { thread: threadOut(ctx.db, dm) }; }
  }

  // A Run in a record's channel shows up there as one line, and its chat hangs under that line.
  let parent: { threadId: string; messageId: string } | undefined;
  const channel = isRun && input.recordId !== undefined ? channelOfRecord(ctx.db, input.recordId) : null;
  if (channel) {
    const main = threadBy(ctx.db, channel.mainThread);
    if (main) {
      const line = insertMessage(ctx, main.id, { author: ctx.principal.id, kind: "system", body: `${input.title?.trim() || "A Run"} started. Its chat is in this thread.` });
      deliver(ctx, main, line, [], { kind: ctx.principal.kind, id: ctx.principal.id }, { notify: false });
      parent = { threadId: main.id, messageId: line.id };
    }
  }

  const t = insertThread(ctx, {
    kind: isRun ? "run" : input.kind, title: input.title?.trim() || undefined, starter: asker, recordId: input.recordId, folderId: input.folderId, scopeType: input.scopeType, scopeId: input.scopeId,
    parentThreadId: parent?.threadId, parentMessageId: parent?.messageId, listed: input.kind === "chat" && !isRun,
  });
  if (asker.startsWith("usr_")) addMember(ctx, t.id, asker, "owner");
  if (personId !== undefined) addMember(ctx, t.id, personId);
  // The first agent leads when nobody else is talking; a second person (a direct message) or more agents mean the rest listen.
  const engaged = agentIds.map((agentId, i): { agentId: string; mode: Mode } => ({ agentId, mode: i === 0 && personId === undefined ? "lead" : "listen" }));
  for (const a of engaged) addAgent(ctx, t.id, { ...a, model: input.model, provider: input.provider, effort: input.effort, addedBy: asker });

  emitStarted(ctx, t);
  emitAgentsEngaged(ctx, t.id, engaged, asker);
  postFirst(ctx, t, input.first);
  return { thread: threadOut(ctx.db, t) };
}

// ---- inline threads ---------------------------------------------------------------------------------------------------------------------------------

export async function thread(ctx: ChatCtx, input: { threadId: string; messageId: string }) {
  ensure(ctx.db);
  const parent = threadBy(ctx.db, input.threadId);
  const msg = messageBy(ctx.db, input.messageId);
  if (!parent || !msg || msg.thread !== parent.id || !canSpeak(ctx, parent)) raise(ctx, "validation.not_found", "That message does not exist or is not yours to reply to.");
  const existing = (ctx.db.all("SELECT id FROM chat_thread WHERE parentMessageId = ? AND deleted_at IS NULL ORDER BY createdAt LIMIT 1", msg.id) as Row[])[0];
  if (existing) return { thread: threadOut(ctx.db, threadBy(ctx.db, String(existing["id"]))!) };

  const asker = askerOf(ctx);
  const t = insertThread(ctx, { kind: "thread", starter: asker, parentThreadId: parent.id, parentMessageId: msg.id, listed: false });
  if (asker.startsWith("usr_")) addMember(ctx, t.id, asker, "owner");
  // An agent works inside the thread under its own message, and the agent that opens a thread leads it (spec 2.5); people's threads otherwise leave agents listening.
  const leads = [msg.author, ctx.principal.id].filter((id, i, all) => id.startsWith("agt_") && all.indexOf(id) === i);
  if (leads.length > 0) addAgent(ctx, t.id, { agentId: leads[0]!, mode: "lead", addedBy: asker });
  emitStarted(ctx, t);
  return { thread: threadOut(ctx.db, t) };
}

// ---- channels ---------------------------------------------------------------------------------------------------------------------------------------

export async function makeChannel(ctx: ChatCtx, input: { threadId: string; personId: string; name?: string }) {
  ensure(ctx.db);
  const src = threadBy(ctx.db, input.threadId);
  if (!src || !canSpeak(ctx, src)) raise(ctx, "validation.bad_input", "That chat does not exist or is not yours.");
  if (src.kind !== "chat" || src.channelId !== undefined) raise(ctx, "validation.bad_input", "Only a private chat becomes a channel.");
  const asker = askerOf(ctx);
  if (!input.personId.startsWith("usr_") || input.personId === asker) raise(ctx, "validation.bad_input", "Pick another person for the channel.");

  let name: string;
  if (input.name !== undefined && input.name.trim() !== "") {
    name = cleanName(ctx, input.name);
    if (channelByName(ctx.db, name)) raise(ctx, "validation.bad_input", "A channel with that name already exists.", { name });
  } else {
    const base = cleanName(ctx, src.title ?? "Team chat");
    name = base;
    for (let n = 2; channelByName(ctx.db, name); n++) name = `${base} ${n}`;
  }

  const channelId = mintId("chn", ctx.now());
  const main = insertThread(ctx, { kind: "channel", title: name, starter: asker, channelId, parentThreadId: src.id, recordId: src.recordId, folderId: src.folderId, listed: true });
  const people = [...new Set([asker, ...membersOf(ctx.db, src.id).filter((p) => !p.startsWith("agt_")), input.personId])];
  for (const p of people) addMember(ctx, main.id, p, p === asker ? "owner" : "member");
  // The chat's agents come along and listen: in a channel an agent answers when it is @mentioned.
  for (const a of agentsOf(ctx.db, src.id)) addAgent(ctx, main.id, { agentId: a.agentId, mode: "listen", model: a.model, provider: a.provider, effort: a.effort, accountRef: a.accountRef, addedBy: asker });
  const channel = insertChannel(ctx, { id: channelId, mainThread: main.id, name, visibility: "invite", folderId: src.folderId, recordId: src.recordId, createdBy: asker });
  ctx.emit("channel.created", channel.id, { channelId: channel.id, name, visibility: "invite", ...(src.recordId !== undefined ? { recordId: src.recordId } : {}) });
  ctx.emit("thread.promoted", src.id, { threadId: src.id, channelId: channel.id, personId: input.personId });
  return { channel: channelOut(ctx.db, channel) };
}

export async function channelsCreate(ctx: ChatCtx, input: { name: string; visibility: "public" | "invite"; topic?: string; memberIds?: string[]; agentIds?: string[]; folderId?: string; recordId?: string; idempotencyKey?: string }) {
  ensure(ctx.db);
  const name = cleanName(ctx, input.name);
  if (channelByName(ctx.db, name)) raise(ctx, "validation.bad_input", "A channel with that name already exists.", { name });
  if (input.recordId !== undefined && channelOfRecord(ctx.db, input.recordId)) raise(ctx, "validation.bad_input", "That record already has a channel.", { recordId: input.recordId });
  const memberIds = uniqueIds(ctx, input.memberIds, "usr_", "a person");
  const agentIds = uniqueIds(ctx, input.agentIds, "agt_", "an agent");
  const topic = input.topic?.trim() || undefined;
  if (topic !== undefined && topic.length > 250) raise(ctx, "validation.bad_input", "A topic can be at most 250 characters.");

  const asker = askerOf(ctx);
  const channelId = mintId("chn", ctx.now());
  const main = insertThread(ctx, { kind: "channel", title: name, starter: asker, channelId, recordId: input.recordId, folderId: input.folderId, listed: true });
  if (asker.startsWith("usr_")) addMember(ctx, main.id, asker, "owner");
  for (const p of memberIds) addMember(ctx, main.id, p);
  // Agents are invited as listeners: in a channel they answer when asked, and act unmentioned only where "watches this channel" is on.
  for (const agentId of agentIds) addAgent(ctx, main.id, { agentId, mode: "listen", addedBy: asker });
  const channel = insertChannel(ctx, { id: channelId, mainThread: main.id, name, topic, visibility: input.visibility, folderId: input.folderId, recordId: input.recordId, createdBy: asker });
  ctx.emit("channel.created", channel.id, { channelId: channel.id, name, visibility: input.visibility, ...(input.recordId !== undefined ? { recordId: input.recordId } : {}) });
  emitStarted(ctx, main);
  return { channel: channelOut(ctx.db, channel) };
}

const kindOfTool = (name: string): "claude_code" | "codex" | "other" => (/codex/i.test(name) ? "codex" : /claude/i.test(name) ? "claude_code" : "other");

export async function connectOutsideAgent(
  ctx: ChatCtx, input: { channelId: string; name: string; scopes?: { read: boolean; post: boolean; readChangesets: boolean; writeBranch: boolean }; idempotencyKey?: string },
) {
  ensure(ctx.db);
  const channel = channelBy(ctx.db, input.channelId);
  if (!channel) raise(ctx, "validation.not_found", "That channel does not exist.");
  if (channel.archived) raise(ctx, "validation.bad_input", "An archived channel takes no new connections.");
  const name = input.name.trim();
  if (name === "" || name.length > 120) raise(ctx, "validation.bad_input", "Give the connection a name of up to 120 characters.");
  if (!ctx.call) raise(ctx, "internal.unexpected", "The MCP server is not available right now.");
  const kind = kindOfTool(name);
  // The MCP module mints the one-time token (10 minutes, shown once) and logs it; this channel only asks for it.
  const issued = (await ctx.call("mcp.token.issue", {
    name, kind, channelId: channel.id, ...(input.scopes ? { scopes: input.scopes } : {}), idempotencyKey: input.idempotencyKey ?? `${ctx.trace.traceId}:connect:${channel.id}`,
  })) as { oneTimeToken: string; expiresAt: number; mcpUrl: string };
  const runCommand = kind === "other" ? `mcp add vyre ${issued.mcpUrl} --token ${issued.oneTimeToken}` : `${kind === "codex" ? "codex" : "claude"} mcp add vyre ${issued.mcpUrl} --token ${issued.oneTimeToken}`;
  return { mcpUrl: issued.mcpUrl, oneTimeToken: issued.oneTimeToken, expiresAt: issued.expiresAt, runCommand };
}

// ---- blocks that park a turn ------------------------------------------------------------------------------------------------------------------------

const onlyPeople = (ctx: ChatCtx): void => {
  if (ctx.principal.kind !== "person") raise(ctx, "validation.precondition_failed", "A person answers this, not an agent.");
};

/** Does `answer` fit the question? single: one option (or free text where Other is on); multi: a list of options; free: text. */
function answerFits(data: Record<string, unknown>, answer: unknown): boolean {
  const mode = String(data["mode"] ?? "free");
  const keys = Array.isArray(data["options"]) ? (data["options"] as Array<{ key?: unknown }>).map((o) => String(o.key)) : [];
  const other = data["allowOther"] === true;
  const text = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
  const otherText = (v: unknown): boolean => other && (text(v) || (typeof v === "object" && v !== null && !Array.isArray(v) && text((v as Record<string, unknown>)["other"])));
  if (mode === "free") return text(answer);
  if (mode === "single") return (typeof answer === "string" && keys.includes(answer)) || otherText(answer);
  if (!Array.isArray(answer) || answer.length === 0) return false;
  return answer.every((a) => (typeof a === "string" && keys.includes(a)) || otherText(a));
}

export async function answerBlock(ctx: ChatCtx, input: { threadId: string; blockId: string; answer: unknown }) {
  ensure(ctx.db);
  const block = blockBy(ctx.db, input.blockId);
  const t = threadBy(ctx.db, input.threadId);
  if (!block || !t || block.thread !== t.id || !canSpeak(ctx, t)) raise(ctx, "validation.not_found", "That question does not exist.");
  onlyPeople(ctx);
  if (block.type !== "question") raise(ctx, "validation.precondition_failed", "Approve or send back a plan with its own buttons.");
  if (block.state === "done") {
    // Answering twice with the same answer is the same answer (an offline resend); a different one comes too late.
    if (JSON.stringify(block.answer) === JSON.stringify(input.answer)) return { ok: true };
    raise(ctx, "validation.precondition_failed", "This question was already answered.");
  }
  if (!answerFits(block.data, input.answer)) raise(ctx, "validation.bad_input", "That answer does not fit the question.");

  const by = askerOf(ctx);
  ctx.db.run("UPDATE chat_block SET state = 'done', answer = ?, answeredBy = ?, answeredAt = ? WHERE id = ?", JSON.stringify(input.answer), by, ctx.now(), block.id);
  patchBlockInMessage(ctx.db, block.message, block.id, (b) => ({ ...b, state: "done", data: { ...(b["data"] as Record<string, unknown>), answer: input.answer, answeredBy: by } }));
  // The engine reads block.answered and queues a wake, so the parked turn continues in the same thread.
  ctx.emit("block.answered", t.id, { threadId: t.id, blockId: block.id, by });
  return { ok: true };
}

export interface PlanEdit { stepId: string; text?: string; remove?: boolean }

export async function approvePlan(ctx: ChatCtx, input: { threadId: string; planId: string; edits?: PlanEdit[] }) {
  ensure(ctx.db);
  const plan = planBy(ctx.db, input.planId);
  const t = threadBy(ctx.db, input.threadId);
  if (!plan || !t || plan.thread !== t.id || !canSpeak(ctx, t)) raise(ctx, "validation.not_found", "That plan does not exist.");
  onlyPeople(ctx);
  const edits = input.edits ?? [];
  const view = (steps: PlanStep[]) => ({ planId: plan.id, state: plan.state, steps });
  if (plan.state === "approved" && edits.length === 0) return { plan: view(plan.steps) };
  if (plan.state !== "proposed") raise(ctx, "validation.precondition_failed", `This plan was already ${plan.state}.`);

  let steps = plan.steps.map((s) => ({ ...s }));
  for (const e of edits) {
    const i = steps.findIndex((s) => s.stepId === e.stepId);
    if (i < 0) raise(ctx, "validation.bad_input", "That step is not in this plan.", { stepId: e.stepId });
    if (e.remove === true) { steps = steps.filter((s) => s.stepId !== e.stepId); continue; }
    if (e.text !== undefined) {
      if (e.text.trim() === "") raise(ctx, "validation.bad_input", "A step needs words.", { stepId: e.stepId });
      steps[i] = { ...steps[i]!, text: e.text.trim() };
    }
  }
  if (steps.length === 0) raise(ctx, "validation.bad_input", "A plan needs at least one step. Send it back instead.");

  const by = askerOf(ctx);
  const now = ctx.now();
  ctx.db.run("UPDATE chat_plan SET state = 'approved', steps = ?, decidedBy = ?, decidedAt = ? WHERE id = ?", JSON.stringify(steps), by, now, plan.id);
  ctx.db.run("UPDATE chat_block SET state = 'done', answer = ?, answeredBy = ?, answeredAt = ? WHERE id = ?", JSON.stringify({ approved: true, edited: edits.length > 0 }), by, now, plan.block);
  // Approving ends plan mode for the thread: the agent may now change things, and the steps tick off as they finish.
  ctx.db.run("UPDATE chat_thread SET modePlan = 0, updated_at = ? WHERE id = ?", now, t.id);
  const block = blockBy(ctx.db, plan.block);
  if (block) patchBlockInMessage(ctx.db, block.message, block.id, (b) => ({ ...b, state: "done", data: { ...(b["data"] as Record<string, unknown>), steps, state: "approved" } }));
  ctx.emit("plan.approved", t.id, { planId: plan.id, threadId: t.id, edited: edits.length > 0, by });
  ctx.emit("block.answered", t.id, { threadId: t.id, blockId: plan.block, by });
  return { plan: { planId: plan.id, state: "approved", steps } };
}

