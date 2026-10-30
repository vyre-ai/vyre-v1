// A rig for the matrix and trace tests: the access store over an in-memory SQL stand-in that runs the statement shapes the share handlers use, a fixed clock, five people who are Members, and an
// owner. (Modules may not import node:sqlite, so the real handlers run against this, as share.test.ts does.)
import { putPrincipal } from "../../handlers/roles.ts";
import type { ShareCtx } from "../../handlers/share.ts";
import { MemoryDb } from "../../fixtures/db.ts";
import { EVERYONE, storeOf } from "../../projections.ts";

export const NOW = 1_700_000_000_000;

/** The access tables' in-memory SQL (modules/access/fixtures/db.ts), shared with the other access tests. */
export class SqlDb extends MemoryDb {}

export function rig() {
  const db = new SqlDb();
  const events: { name: string; subject: string; payload: unknown }[] = [];
  const ctx: ShareCtx = {
    space: "spc_test", principal: { kind: "person", id: "usr_admin" }, trace: { traceId: "0123456789abcdef0123456789abcdef" },
    now: () => NOW, db, emit(name, subject, payload) { events.push({ name, subject, payload }); },
  };
  const store = storeOf(ctx);
  const everyone = store.groups.get(EVERYONE)!;
  for (const id of ["usr_admin", "usr_a", "usr_b", "usr_c"]) {
    putPrincipal(store, { id, kind: "person", name: id });
    store.setRoles(id, [id === "usr_admin" ? "rol_owner" : "rol_member"]);
    everyone.members.push({ kind: "person", id });
  }
  store.bump();
  const as = (id: string): ShareCtx => ({ ...ctx, principal: { kind: "person", id } });
  const item = (id: string, owner: string | null, type = "site"): void => {
    store.resources.set(id, { id, type, parentId: null, label: "public", ownerId: owner, holds: 0, row: { title: id } });
    store.bump();
  };
  return { db, ctx, events, store, as, item };
}
