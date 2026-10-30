// Who sees what of a stored connector. The author (its owner, or someone with connectors.manage) sees every part and its level.
// Everyone else sees only the parts a person published. A draft or a tested part is the author's until then.
import type { ConnectorDef } from "./connector-def.ts";
import { levelOfAction, levelOfTrigger } from "./connector-store.ts";
import type { ConnectorRow, Db } from "./connector-store.ts";
import { me } from "./projections.ts";
import type { AutoCtx } from "./projections.ts";

export function isAuthor(ctx: AutoCtx, row: ConnectorRow): boolean {
  if (row.owner.id === me(ctx)) return true;
  return !!ctx.authorize && ctx.authorize({ perm: "connectors.manage", level: "manage" }, { type: "space", id: ctx.space }).effect === "allow";
}

/** The part of a definition other people may see: published actions and triggers only. Null when nothing is published. */
export function publishedPart(db: Db, def: ConnectorDef): ConnectorDef | null {
  const actions = def.actions.filter((a) => levelOfAction(db, def.app, a.key) === "published");
  const triggers = def.triggers.filter((t) => levelOfTrigger(db, def.app, t.key) === "published");
  return actions.length + triggers.length === 0 ? null : { ...def, actions, triggers };
}
