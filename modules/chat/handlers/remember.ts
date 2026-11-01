// chat.remember (rc.9, "Remember that decision"): one message becomes a fact, in the memory of the project the chat belongs to (its record or its project channel), else in the person's own. The fact's
// source is the message, so recall in a later chat brings it back with the link; the Learned line under the message is the memory module's own (memory.learned for this message), and a "Remembered
// for Rivera matter" card in the thread links to the fact. A shared layer keeps its own review rule: when the fact waits for a yes the card says "Proposed to ...", not "Remembered".
import { agentsOf, askerOf, channelBy, ensure, messageBy, raise, threadBy } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";
import { load } from "./g24a.ts";
import { postLinkCard } from "./link-card.ts";
import { rootOf } from "./post.ts";

const MAX_TEXT = 400;
const CARD_TITLE = 90;

/** The words of a message as a fact: its text on one line, cut at 400 letters (the same rule the menu has always used). */
export function factText(body: string): string {
  const t = body.replace(/\s+/g, " ").trim();
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1)}…` : t;
}

interface ProjectRow { projectId: string; recordId?: string; channelId?: string; title: string }

/** The project this chat belongs to for the person asking, or none: the chat's record, its channel, or the record or channel of the chat it hangs under. */
async function projectOf(ctx: ChatCtx, threadId: string): Promise<ProjectRow | null> {
  if (!ctx.call) return null;
  const t = threadBy(ctx.db, threadId);
  if (!t) return null;
  const root = rootOf(ctx, t);
  const recordIds = new Set([t.recordId, root.recordId].filter((x): x is string => x !== undefined));
  const channelIds = new Set([t.channelId, root.channelId].filter((x): x is string => x !== undefined));
  for (const id of [...channelIds]) { const rec = channelBy(ctx.db, id)?.recordId; if (rec) recordIds.add(rec); }
  if (recordIds.size === 0 && channelIds.size === 0) return null;
  let listed: { projects?: ProjectRow[] };
  try { listed = (await ctx.call("projects.list", {})) as { projects?: ProjectRow[] }; } catch { return null; }
  return (listed.projects ?? []).find((p) => (p.recordId !== undefined && recordIds.has(p.recordId)) || (p.channelId !== undefined && channelIds.has(p.channelId))) ?? null;
}

export async function remember(ctx: ChatCtx, input: { threadId: string; messageId: string; text?: string; idempotencyKey: string }) {
  ensure(ctx.db);
  const t = load(ctx, input.threadId);
  const m = messageBy(ctx.db, input.messageId);
  if (!m || m.thread !== t.id) raise(ctx, "validation.not_found", "That message is not in this chat.");
  if (m.kind === "system" || m.kind === "quiet") raise(ctx, "validation.bad_input", "Remember something someone said, not a notice.");
  const text = factText(input.text?.trim() || m.body);
  if (text === "") raise(ctx, "validation.bad_input", "There are no words in this message to remember.");
  if (!ctx.call) raise(ctx, "internal.unavailable", "Memory is not available just now.");
  const project = await projectOf(ctx, t.id);
  // a person's own memory is kept per agent (People/<person>/memory/<agent>) and recall reads it for the agent that is answering: so it is kept for the agent that leads this chat. A chat with no agent
  // in it has none to keep it for, and the fact waits in the person's layer unscoped.
  const root = rootOf(ctx, t);
  const leader = agentsOf(ctx.db, root.id).find((a) => a.mode === "lead") ?? agentsOf(ctx.db, root.id)[0];
  const out = (await ctx.call("memory.remember", { text, threadId: t.id, sourceRef: m.id, ...(project ? { layer: "project", projectId: project.projectId } : leader ? { agentId: leader.agentId } : {}) })) as { fact: { factId: string; layer?: string }; merged: boolean };
  // a person who says "remember this" for a project they may edit is not held back (a person typing a fact in is not); one who may not edit leaves it proposed for someone who can
  let merged = out.merged;
  if (!merged && project) {
    try { await ctx.call("memory.fact.accept", { factId: out.fact.factId }); merged = true; } catch { /* no edit on the project: it stays proposed, and the card says so */ }
  }
  const lead = project ? (merged ? `Remembered for ${project.title}` : `Proposed to ${project.title}`) : "Remembered";
  const title = text.length > CARD_TITLE ? `${text.slice(0, CARD_TITLE - 1)}…` : text;
  postLinkCard(ctx, t.id, { icon: "fact", lead, title, target: { type: "fact", id: out.fact.factId } }, `${lead}: ${title}`);
  return { factId: out.fact.factId, layer: project ? "project" : "person", merged, ...(project ? { projectId: project.projectId, projectTitle: project.title } : {}), by: askerOf(ctx) };
}
