// Hooks module (lane l-hooks): one layer for the hooks of every model. Handlers, and the consumer that links a helper thread to the chat that started it so a run's hooks reach its helpers.
import { fire, list, pause, policyGet, policySet, remove, runsList, set } from "./handlers/index.ts";
import { link } from "./projections.ts";
import type { HooksCtx } from "./projections.ts";
import { bindHooks } from "./seams.ts";

export const handlers = { "hooks.fire": fire, "hooks.list": list, "hooks.pause": pause, "hooks.policy.get": policyGet, "hooks.policy.set": policySet, "hooks.remove": remove, "hooks.runs.list": runsList, "hooks.set": set };
export { bindHooks };

type Ev = { payload?: { helperThreadId?: string; parentThreadId?: string } };
export const consumers = {
  /** A helper started under a chat: its turns see the run hooks of the chat that started it. */
  "hooks.helpers": {
    on: ["helper.started"],
    run: (ctx: HooksCtx, event: Ev): string[] => {
      const p = event.payload;
      if (p?.helperThreadId && p.parentThreadId) link(ctx, p.helperThreadId, p.parentThreadId);
      return [];
    },
  },
};
