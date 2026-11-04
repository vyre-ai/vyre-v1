// One handler per tasks capability (30). State changes and reads live in state.ts; act, delegate, escalate and stuck detection in act.ts.
import { act, delegate, escalate } from "./act.ts";
import { agentOnIt, ask, block, decide, review, submit } from "./baton.ts";
import {
  assign, countNeedsYou, create, dependenciesAdd, dependenciesRemove, followersAdd, followersRemove, get, history, linksAdd, linksRemove, list, myWorkList,
  needsYouList, heldRevise, notesDelete, notesSet, release, snooze, take, transition, update, withdraw,
} from "./state.ts";

import { byKey, index, rev } from "./index-read.ts";
import { digest } from "./digest.ts";
import { clock } from "./clock.ts";
import { plan } from "./plan.ts";
import { remove, restore } from "./remove.ts";
import { isAgentId, withReversals } from "../../../lib/reversal.ts";
import { historyOf } from "../projections.ts";
import type { TasksCtx } from "../projections.ts";

const base = {
  "tasks.by_key": byKey,
  "tasks.clock": clock,
  "tasks.delete": remove,
  "tasks.digest": digest,
  "tasks.index": index,
  "tasks.plan": plan,
  "tasks.restore": restore,
  "tasks.rev": rev,
  "tasks.act": act,
  "tasks.ask": ask,
  "tasks.assign": assign,
  "tasks.block": block,
  "tasks.count_needs_you": countNeedsYou,
  "tasks.create": create,
  "tasks.decide": decide,
  "tasks.delegate": delegate,
  "tasks.dependencies.add": dependenciesAdd,
  "tasks.dependencies.remove": dependenciesRemove,
  "tasks.escalate": escalate,
  "tasks.followers.add": followersAdd,
  "tasks.followers.remove": followersRemove,
  "tasks.get": get,
  "tasks.history": history,
  "tasks.links.add": linksAdd,
  "tasks.links.remove": linksRemove,
  "tasks.list": list,
  "tasks.my_work": myWorkList,
  "tasks.needs_you": needsYouList,
  "tasks.release": release,
  "tasks.review": review,
  "tasks.snooze": snooze,
  "tasks.agent_on_it": agentOnIt,
  "tasks.submit": submit,
  "tasks.take": take,
  "tasks.transition": transition,
  "tasks.update": update,
  "tasks.withdraw": withdraw,
  "tasks.working_notes.delete": notesDelete,
  "tasks.working_notes.set": notesSet,
  "tasks.held_revise": heldRevise,
};

/** A person bringing back a task an agent deleted teaches that agent (lib/reversal.ts, memory.corrections.record). The task keeps who did what, so no event lookup is needed. */
export const handlers = withReversals(base, {
  "tasks.restore": {
    actOf: (ctx: TasksCtx, i: { taskId: string }) => {
      const gone = historyOf(ctx.db, i.taskId).find((h) => h.type === "deleted");
      return gone && isAgentId(gone.by) ? { agentId: gone.by, ref: gone.eventId } : null;
    },
    was: (_i: unknown, o: { task?: { title?: string } }) => `deleted the task${o?.task?.title ? ` "${o.task.title}"` : ""}`,
  },
});
