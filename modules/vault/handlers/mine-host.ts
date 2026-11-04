// The host's own writes to a person's Mine items (lane l-ci-runners): the GitHub refresh token must be saved when GitHub rotates it, and that happens on an agent's turn as well as on the person's own, where the
// usual vault.item.put and update (a person's alone for Mine) cannot be used. These two are host calls: the host service only (consumers.ts HOST_ONLY_CALL), never a capability, never in a route or tool.
// The sealing is the one every Mine item has: the item's own key under the owner's wrap key (enc=2) when their key is on this node, else sealed to their public key (enc=3). Nothing is stored in the clear.
import { fail } from "../../../host/src/routes/errors.ts";
import { currentKeyPort, sealMine, sealMineTo, wrapKeyFromPersonKey } from "./crypto.ts";
import type { Field } from "./crypto.ts";
import { MINE_CLOSED, live, sealedOf, storeSealed } from "./items.ts";
import { ensure, first, handleOf, newId, record, rowsOf, str } from "../projections.ts";
import type { VaultCtx } from "../projections.ts";

const FIELD_KEY = /^[A-Za-z][A-Za-z0-9_]*$/;
const NAME = /^[A-Za-z][A-Za-z0-9 _.-]{0,59}$/;
const FOLDER = "Connections";

async function sealFor(ctx: VaultCtx, itemId: string, owner: string, fields: Field[], rev: number) {
  const port = currentKeyPort();
  const key = await port?.personKey(owner);
  if (key) return sealMine(itemId, fields, wrapKeyFromPersonKey(key), rev);
  const pub = await port?.publicKey?.(owner).catch(() => null);
  if (pub) return sealMineTo(itemId, fields, pub, rev);
  throw fail("auth.unauthenticated", ctx.trace.traceId, { message: MINE_CLOSED, details: { reason: "vault_locked" } });
}

/** The handle of a person's host-kept item: the name plus a piece of their id, so every person's "GitHub" has a handle of its own and a handle never leads to someone else's item. */
export const mineHandle = (name: string, owner: string): string => handleOf(`${name}_${owner.replace(/^usr_/, "").slice(0, 12)}`);

const mineByName = (ctx: VaultCtx, owner: string, name: string) =>
  rowsOf(ctx.db.all(`SELECT * FROM vault_meta`)).find((r) => live(r) && str(r, "scope") === "mine" && str(r, "owner") === owner && str(r, "name").toLowerCase() === name.toLowerCase()) ?? null;

/** Put or replace the fields of the owner's Mine item of this name (made in their "Connections" Mine folder the first time). All its fields are secret and the old ones are replaced. */
export async function mineSet(ctx: VaultCtx, input: { owner: string; name: string; fields: Record<string, string> }): Promise<{ itemId: string; handle: string }> {
  ensure(ctx);
  const { owner, name } = input;
  if (typeof owner !== "string" || !/^usr_[a-z0-9]+$/.test(owner) || !NAME.test(name)) throw fail("validation.bad_input", ctx.trace.traceId, { message: "A Mine item needs its owner and a plain name." });
  const entries = Object.entries(input.fields ?? {});
  if (!entries.length || entries.some(([k, v]) => !FIELD_KEY.test(k) || typeof v !== "string" || v.length === 0 || v.length > 8192)) throw fail("validation.bad_input", ctx.trace.traceId, { message: "The fields are not valid." });
  const fields: Field[] = entries.map(([key, value]) => ({ key, value, secret: true }));
  const have = mineByName(ctx, owner, name);
  const now = ctx.now();
  if (have) {
    const id = str(have, "id");
    storeSealed(ctx, id, await sealFor(ctx, id, owner, fields, sealedOf(ctx, id).rev + 1));
    ctx.db.run(`UPDATE vault_meta SET "fieldKeys" = ?, "updated_at" = ?, "updatedAt" = ? WHERE "id" = ?`, JSON.stringify(fields.map((f) => f.key)), now, now, id);
    ctx.db.run(`UPDATE vault_item_x SET "secrets" = ?, "lastRotatedAt" = ? WHERE "itemId" = ?`, JSON.stringify(Object.fromEntries(fields.map((f) => [f.key, true]))), now, id);
    record(ctx, id, "edited", { detail: "kept by Vyre" });
    ctx.emit("vault.item_updated", `vault_item/${id}`, { itemId: id, fieldsChanged: fields.map((f) => f.key), settingsChanged: [] }, { vis: "participants" });
    return { itemId: id, handle: str(have, "handle") };
  }
  let folder = rowsOf(ctx.db.all(`SELECT * FROM vault_folder`)).find((f) => live(f) && str(f, "scope") === "mine" && str(f, "owner") === owner && str(f, "name") === FOLDER && !str(f, "parentId"));
  if (!folder) {
    const fid = newId("vfd", now);
    ctx.db.run(`INSERT INTO vault_folder ("id", "name", "parentId", "scope", "owner", "whoCanExport", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?)`, fid, FOLDER, null, "mine", owner, "owner", now);
    folder = first(ctx.db.all(`SELECT * FROM vault_folder WHERE "id" = ?`, fid)) ?? undefined;
  }
  const id = newId("vit", now);
  storeSealed(ctx, id, await sealFor(ctx, id, owner, fields, 1));
  ctx.db.run(
    `INSERT INTO vault_meta ("id", "name", "kind", "folderId", "owner", "scope", "fieldKeys", "handle", "spaceOnly", "injectIntoDeployments", "rotateEveryDays", "version", "updated_at", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, name, "api_key", str(folder!, "id"), owner, "mine", JSON.stringify(fields.map((f) => f.key)), mineHandle(name, owner), 1, 0, null, 0, now, now,
  );
  ctx.db.run(`INSERT INTO vault_item_x ("itemId", "createdAt", "secrets") VALUES (?, ?, ?)`, id, now, JSON.stringify(Object.fromEntries(fields.map((f) => [f.key, true]))));
  record(ctx, id, "created", { detail: "kept by Vyre" });
  ctx.emit("vault.item_created", `vault_item/${id}`, { itemId: id, kind: "api_key", folderId: str(folder!, "id"), scope: "mine", name }, { vis: "participants" });
  return { itemId: id, handle: mineHandle(name, owner) };
}

/** Move the owner's Mine item of this name to the Trash (it stays exportable by them for 30 days, like any Mine item they delete). */
export function mineRemove(ctx: VaultCtx, input: { owner: string; name: string }): { removed: boolean } {
  ensure(ctx);
  const have = mineByName(ctx, input.owner, input.name);
  if (!have) return { removed: false };
  ctx.db.run(`UPDATE vault_meta SET "deleted_at" = ?, "updated_at" = ? WHERE "id" = ?`, ctx.now(), ctx.now(), str(have, "id"));
  record(ctx, str(have, "id"), "deleted", { detail: "removed by Vyre" });
  return { removed: true };
}
