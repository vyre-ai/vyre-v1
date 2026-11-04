// access.reach: for the caller, what level they hold on each of a list of things, in one call (owner, 4 Nov: never send anyone to a place they cannot open). The shell asks it for every link on
// screen at once, so a link renders as a live link, a peek or plain text before anyone presses it. It is the same decision authorize makes for the thing's own page, and a thing that does not exist
// is told apart from one the caller cannot see by nothing: both answer "none".
import { authorize } from "../../../kernel/src/authorize/index.ts";
import type { Level } from "../../../kernel/src/authorize/index.ts";
import { storeOf } from "../projections.ts";
import type { AccessCtx, ResourceRef } from "../projections.ts";
import { toReq } from "./check.ts";
import { personOf } from "./request.ts";
import type { AskCtx } from "./request.ts";

const LADDER: readonly Level[] = ["manage", "edit", "use", "view"];
export const REACH_MAX = 200;

const strOf = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

export async function reachBatch(ctx: AskCtx & AccessCtx, input: { items: ResourceRef[] }) {
  const store = storeOf(ctx);
  const me = personOf(ctx);
  const items = (input.items ?? []).slice(0, REACH_MAX);
  return {
    items: items.map((it) => {
      const known = store.resources.get(it.id);
      // a registered thing of another type is not this thing; one the store has not registered is judged by the same rules as any other (a role that reaches every file reaches it)
      if (known !== undefined && known.type !== it.type) return { type: it.type, id: it.id, level: "none" as const };
      for (const level of LADDER) {
        const d = authorize(store.snapshot(), toReq(ctx, { principal: { kind: "person", id: me }, action: { level }, resource: { type: it.type, id: it.id } }));
        if (d.effect === "allow") {
          const title = strOf(known?.row?.["name"]) ?? strOf(known?.row?.["title"]);
          return { type: it.type, id: it.id, level, ...(title !== undefined ? { title } : {}) };
        }
      }
      return { type: it.type, id: it.id, level: "none" as const };
    }),
  };
}
