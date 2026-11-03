// memory.corrections.record: a correction made outside the chat's own words (an edit of the agent's draft, a declined or sent-back action, an undo) becomes a lesson, the same fact a correction said in
// chat becomes (lessons.ts). The callers are the modules where the correction happens (gate.deny, a draft edit); they pass what the person changed and, when they have it, their own note.
// Nothing is kept when the person's switch "Learn from my corrections" is off, when the chat is set not to be remembered, when the agent keeps no memory, or when the only words there are
// would come from a chat other people read.
import { createHash } from "node:crypto";
import { factRows } from "../enrich.ts";
import { HOWS, lessonText, lessonsOn, writeLesson } from "../lessons.ts";
import type { How } from "../lessons.ts";
import { actorOf, ensure, raise, seenByOthers } from "../projections.ts";
import type { MemCtx } from "../projections.ts";
import { whoIs } from "../trail.ts";
import { modeOf, shouldLearn } from "./learn.ts";

export interface CorrectionIn { agentId: string; how: How; was?: string; now?: string; note?: string; threadId?: string; ref?: string }
export interface CorrectionOut { kept: boolean; why?: "off" | "forgotten" | "nothing" | "duplicate"; lesson?: ReturnType<typeof factRows>[number] }

export async function recordCorrection(ctx: MemCtx, input: CorrectionIn): Promise<CorrectionOut> {
  ensure(ctx.db);
  // only a person's own correction teaches: the caller acts as the person who made it
  if (ctx.principal.kind !== "person") raise(ctx, "permission.no_grant", "A correction is recorded as the person who made it.");
  if (!HOWS.has(input.how)) raise(ctx, "validation.bad_input", "Say how it was corrected: edit, refuse, reverse or rewrite.", { how: input.how });
  if (!(await lessonsOn(ctx))) return { kept: false, why: "off" };
  if (input.threadId && !shouldLearn(ctx, input.threadId)) return { kept: false, why: "forgotten" };
  const mode = await modeOf(ctx, input.agentId);
  if (mode === "off") return { kept: false, why: "off" };
  const shared = input.threadId ? await seenByOthers(ctx, input.threadId) : false;
  const text = lessonText({ how: input.how, ...(input.was ? { was: input.was } : {}), ...(input.now ? { now: input.now } : {}), ...(input.note ? { note: input.note } : {}) }, shared);
  if (text === null) return { kept: false, why: "nothing" };
  const me = actorOf(ctx);
  const key = `corr:${me}:${input.agentId}:${input.how}:${createHash("sha256").update(input.ref ?? `${input.was ?? ""}|${input.now ?? ""}|${input.note ?? ""}`).digest("hex").slice(0, 24)}`;
  const made = writeLesson(ctx, {
    agentId: input.agentId, how: input.how, text, who: whoIs(ctx), key, ...(input.threadId ? { threadId: input.threadId } : {}), sourceKind: input.threadId ? "chat" : "manual",
    audience: input.threadId && shared ? [["heard_in", input.threadId]] : [], propose: mode === "propose",
  });
  if (!made) return { kept: false, why: "duplicate" };
  return { kept: true, lesson: factRows(ctx, [made])[0]! };
}
