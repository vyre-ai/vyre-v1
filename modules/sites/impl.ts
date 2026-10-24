// sites handlers. Promote, rollback and site tables are the next sites packet.
import type { Ctx } from "../../packages/contracts/src/ctx.ts";
import { notImplemented, VyreErr } from "../../packages/contracts/src/errors.ts";
import { coreHandlers } from "./handlers/index.ts";
import { consumers, inline } from "./projections.ts";

function later(cap: string): (ctx: Ctx, _input: unknown) => Promise<never> {
  return async (ctx) => {
    throw new VyreErr(notImplemented(cap, ctx.trace));
  };
}

export const handlers = {
  ...coreHandlers,
  "sites.promote": later("sites.promote"),
  "sites.rollback": later("sites.rollback"),
  "sites.table_create": later("sites.table_create"),
  "sites.table_promote": later("sites.table_promote"),
  "sites.tables": later("sites.tables"),
};

export const projections = { inline, consumers };
export const codecs = {};
