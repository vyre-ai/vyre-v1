// Review of sampled turns (spec 3.10; Console AI > Review): engine.review.list and engine.review.mark.
// Turns are sampled when they finish (turns.ts, by the engine.review_sampling setting). A person marks one fine, or flags it, which opens an incident.
import { openIncident } from "../control.ts";
import { actorOf, raise } from "../../projections.ts";
import type { EngineCtx } from "../../projections.ts";
import { ensureExtra } from "./schema.ts";
import { num, optStr, pageOf, rows, str } from "./util.ts";

type State = "waiting" | "ok" | "flagged";

export function reviewList(ctx: EngineCtx, input: { state?: State; cursor?: string; limit?: number }): {
  items: Array<{ turnId: string; threadId: string; agentId: string; sampledAt: number; state: State }>; next?: string; total?: number;
} {
  ensureExtra(ctx.db);
  const where = input.state === undefined ? "" : " WHERE state = ?";
  const all = rows(ctx, `SELECT * FROM engine_review${where} ORDER BY sampled_at DESC, turn_id DESC`, ...(input.state === undefined ? [] : [input.state])).map((r) => ({
    turnId: str(r["turn_id"]), threadId: str(r["thread_id"]), agentId: str(r["agent_id"]), sampledAt: num(r["sampled_at"]), state: str(r["state"]) as State,
  }));
  const p = pageOf(all, input);
  return { items: p.items, ...(p.next === undefined ? {} : { next: p.next }), total: p.total };
}

export function reviewMark(ctx: EngineCtx, input: { turnId: string; verdict: "ok" | "flagged"; note?: string }): { incidentId?: string } {
  ensureExtra(ctx.db);
  const turn = rows(ctx, "SELECT thread_id, agent_id FROM engine_turns WHERE turn_id = ?", input.turnId)[0];
  const cur = rows(ctx, "SELECT * FROM engine_review WHERE turn_id = ?", input.turnId)[0];
  if (!turn && !cur) raise(ctx, "validation.not_found", "There is no such turn.", { turnId: input.turnId });
  const by = actorOf(ctx);
  // Marking again with the same verdict returns the first answer, including the incident it opened.
  if (cur && str(cur["state"]) === input.verdict) {
    const incidentId = optStr(cur["incident_id"]);
    return incidentId === undefined ? {} : { incidentId };
  }
  const threadId = str((cur ?? turn)?.["thread_id"]), agentId = str((cur ?? turn)?.["agent_id"]);
  if (!cur) ctx.db.run("INSERT INTO engine_review (turn_id, thread_id, agent_id, sampled_at, state) VALUES (?, ?, ?, ?, 'waiting')", input.turnId, threadId, agentId, ctx.now());
  let incidentId: string | undefined;
  if (input.verdict === "flagged") {
    incidentId = openIncident(ctx, {
      kind: "person_report", title: `A reviewer flagged a turn of ${agentId}`, agentId, turnId: input.turnId, ...(input.note === undefined ? {} : { note: input.note }),
    }).incidentId;
  }
  ctx.db.run(
    "UPDATE engine_review SET state = ?, reviewed_by = ?, reviewed_at = ?, note = ?, incident_id = ? WHERE turn_id = ?",
    input.verdict, by, ctx.now(), input.note ?? null, incidentId ?? null, input.turnId,
  );
  ctx.emit("review.marked", input.turnId, { turnId: input.turnId, verdict: input.verdict, by });
  return incidentId === undefined ? {} : { incidentId };
}
