// Subscription sign-ins as accounts (spec 2.17, 4.14): one row per provider and per account the provider names. Signing in again to the same account refreshes the row it has (same provider id, same
// handle, same name); a second account of the provider (a personal and a work Claude) is a second row, named by its account. Sign-ins whose account cannot be read are kept, and the account list shows
// them as one entry per provider, the newest one that works, with the others as "older sign-ins" a person can remove. Rows of one account that were saved twice before this existed are folded into one
// (tidy): the oldest row keeps its id, handle and name and takes the newest working credential; the others go to the Vault Trash with a line in their history, and their handles lead to the row that
// kept the account (vault_provider_alias), so an agent, a chat or a fallback that names one still reaches it.
// DECISION: nothing here guesses that two sign-ins are one account. A sign-in that names an account is only ever matched to a row of that same account; one that names nobody refreshes only a row that
// names nobody either (what the rows did before identities existed). A credential is never overwritten by another account's, and nothing is deleted without a history line and an event.
import { identityOfFields } from "../../../host/src/seams/signin-identity.ts";
import { currentKeyPort } from "./crypto.ts";
import { openFields, uniqueHandle } from "./items.ts";
import { first, num, patchMeta, record, rowsOf, str } from "../projections.ts";
import type { Row, VaultCtx } from "../projections.ts";

export interface Identity { id: string; label?: string }

const live = (r: Row | null): boolean => r !== null && (r["deleted_at"] === null || r["deleted_at"] === undefined);
const item = (ctx: Pick<VaultCtx, "db">, id: string): Row | null => { const r = first(ctx.db.all(`SELECT * FROM vault_meta WHERE id = ?`, id)); return live(r) ? r : null; };
const byAge = (a: Row, b: Row): number => num(a, "createdAt") - num(b, "createdAt") || str(a, "id").localeCompare(str(b, "id"));

/** The person's live subscription rows (whose item is live too), oldest first; one provider when `providerKey` is given. */
export function liveSignins(ctx: Pick<VaultCtx, "db">, owner?: string, providerKey?: string): Row[] {
  return rowsOf(ctx.db.all(`SELECT * FROM vault_provider WHERE "connection" = ?`, "subscription"))
    .filter((p) => live(p) && (owner === undefined || str(p, "owner") === owner) && (providerKey === undefined || str(p, "providerKey") === providerKey) && item(ctx, str(p, "itemId")) !== null)
    .sort(byAge);
}

/** The account a row was signed in to: undefined when it was never looked for, an empty id when it was and the sign-in names nobody. */
export function identityOf(ctx: Pick<VaultCtx, "db">, providerId: string): { id: string; label: string } | undefined {
  const r = first(ctx.db.all(`SELECT * FROM vault_provider_identity WHERE "providerId" = ?`, providerId));
  return r ? { id: str(r, "identity"), label: str(r, "label") } : undefined;
}

export function setIdentity(ctx: Pick<VaultCtx, "db" | "now">, providerId: string, who: Identity | null): void {
  ctx.db.run(`DELETE FROM vault_provider_identity WHERE "providerId" = ?`, providerId);
  ctx.db.run(`INSERT INTO vault_provider_identity ("providerId", "identity", "label", "at") VALUES (?, ?, ?, ?)`, providerId, who?.id ?? "", who?.label ?? null, ctx.now());
}

const known = (ctx: Pick<VaultCtx, "db">, p: Row): string => identityOf(ctx, str(p, "id"))?.id ?? "";
/** When the credential behind a row was last saved: a sign-in again (the item's last rotation), else when the item was made. */
function savedAt(ctx: Pick<VaultCtx, "db">, p: Row): number {
  const x = first(ctx.db.all(`SELECT * FROM vault_item_x WHERE "itemId" = ?`, str(p, "itemId")));
  return Math.max(num(x, "lastRotatedAt"), num(x, "createdAt"));
}
/** Of several rows, the one to show and to keep: the freshest credential that works, else the freshest; a later row wins a tie. */
function newestWorking(ctx: Pick<VaultCtx, "db">, rows: readonly Row[]): Row | undefined {
  const order = [...rows].sort((a, b) => savedAt(ctx, a) - savedAt(ctx, b) || byAge(a, b));
  return [...order].reverse().find((p) => str(p, "state") === "ok") ?? order[order.length - 1];
}

/**
 * The row each grouped sign-in shows under, by provider id. Per person and provider: rows of one account (not folded yet) show as the oldest; rows that name nobody show under the newest row that names
 * an account, or, when none does, under the newest of them that works. A row that is its own entry is not in the map.
 */
export function olderOf(ctx: Pick<VaultCtx, "db">, owner?: string): Map<string, string> {
  const out = new Map<string, string>();
  const groups = new Map<string, Row[]>();
  for (const p of liveSignins(ctx, owner)) {
    const k = `${str(p, "owner")}\u0000${str(p, "providerKey")}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  for (const rows of groups.values()) {
    const named = rows.filter((p) => known(ctx, p) !== "");
    const nameless = rows.filter((p) => known(ctx, p) === "");
    const firstOf = new Map<string, Row>();
    for (const p of named) {
      const keep = firstOf.get(known(ctx, p));
      if (keep) out.set(str(p, "id"), str(keep, "id")); else firstOf.set(known(ctx, p), p);
    }
    const head = newestWorking(ctx, named.length > 0 ? [...firstOf.values()] : nameless);
    if (!head) continue;
    for (const p of nameless) if (str(p, "id") !== str(head, "id")) out.set(str(p, "id"), str(head, "id"));
  }
  return out;
}

/** The handles folded into a row (they lead to it). */
export function aliasesOf(ctx: Pick<VaultCtx, "db">, providerId: string): string[] {
  return rowsOf(ctx.db.all(`SELECT * FROM vault_provider_alias WHERE "providerId" = ?`, providerId)).map((r) => str(r, "handle")).sort();
}

/** The current handle of the item a folded handle now leads to, or null. `name` is the handle with or without its #, never with a field. */
export function aliasTarget(db: VaultCtx["db"], name: string): string | null {
  const want = `#${name.replace(/^#/, "")}`.toLowerCase();
  let hit: Row | undefined;
  try { hit = rowsOf(db.all(`SELECT * FROM vault_provider_alias`)).find((r) => str(r, "handle").toLowerCase() === want); } catch { return null; }
  if (!hit) return null;
  const p = first(db.all(`SELECT * FROM vault_provider WHERE id = ?`, str(hit, "providerId")));
  if (!live(p)) return null;
  const it = item({ db }, str(p, "itemId"));
  return it ? str(it, "handle") : null;
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Is this item name one Vyre gave (the provider's name, with a number, "sign-in" or an account after a comma), rather than one the person typed? */
export function givenByVyre(provider: string, itemName: string): boolean {
  const n = itemName.trim();
  return n === "" || new RegExp(`^${esc(provider)}(?: \\d+| sign-in(?: \\d+)?|, .+)?$`, "i").test(n);
}

/** The name an account reads by in the composer and the pickers: the name the person gave it, else the provider and the account ("Claude Code, irfad@..."), else the provider alone. Never a counter. */
export function shownName(provider: string, itemName: string, label?: string): string {
  if (!givenByVyre(provider, itemName)) return itemName.trim();
  return label ? `${provider}, ${label}` : provider;
}

/** The item name for a new sign-in: the provider and its account, else the provider. A number is added only when that name is taken in the folder (the shown name never carries it). */
export function nameForNew(ctx: Pick<VaultCtx, "db">, folderId: string, provider: string, label?: string): string {
  const base = label ? `${provider}, ${label}` : provider;
  const taken = new Set(rowsOf(ctx.db.all(`SELECT * FROM vault_meta WHERE "folderId" = ?`, folderId)).filter(live).map((r) => str(r, "name").toLowerCase()));
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
  return name;
}

/**
 * Look up the account of the person's own sign-ins that were never looked at. A Claude setup token names nobody, so it is marked as such at once. Codex and Grok keep files that name the account; they
 * are opened only when the call is the person's own (or acts for them) and their key is open on this computer, and only the account is kept. Answers how many rows learned their account.
 */
export async function learnIdentities(ctx: VaultCtx, owner: string): Promise<number> {
  let learned = 0;
  for (const p of liveSignins(ctx, owner)) {
    if (identityOf(ctx, str(p, "id")) !== undefined) continue;
    const provider = str(p, "providerKey");
    if (provider !== "codex" && provider !== "grok") { setIdentity(ctx, str(p, "id"), null); continue; }
    const theirs = (ctx.principal.kind === "person" && ctx.principal.id === owner) || ctx.actingFor === owner;
    if (!theirs || !(await currentKeyPort()?.personKey(owner))) continue;
    try {
      const it = item(ctx, str(p, "itemId"));
      if (!it) continue;
      const who = identityOfFields(provider, await openFields(ctx, it));
      setIdentity(ctx, str(p, "id"), who);
      if (who) learned++;
    } catch { /* not readable now; looked for again next time */ }
  }
  return learned;
}

/**
 * Fold rows of one account into one, for one person or for everyone. The oldest row keeps its id, its handle and its name and takes the newest credential that works; every other row's handle becomes
 * an alias of it, and their items go to the Trash with a history line (restorable, never silent). Answers how many rows were folded.
 */
export function tidySignins(ctx: VaultCtx, owner?: string): number {
  const groups = new Map<string, Row[]>();
  for (const p of liveSignins(ctx, owner)) {
    const who = known(ctx, p);
    if (who === "") continue;
    const k = `${str(p, "owner")}\u0000${str(p, "providerKey")}\u0000${who}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  let folded = 0;
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const keep = rows[0]!, best = newestWorking(ctx, rows)!;
    const keepItem = item(ctx, str(keep, "itemId"))!, bestItem = item(ctx, str(best, "itemId"))!;
    const handle = str(keepItem, "handle"), name = str(keepItem, "name");
    const gone = (it: Row, detail: string): void => {
      patchMeta(ctx, str(it, "id"), { deleted_at: ctx.now() });
      ctx.db.run(`UPDATE vault_item_x SET "deletedBy" = ? WHERE "itemId" = ?`, ctx.principal.id, str(it, "id"));
      record(ctx, str(it, "id"), "deleted", { detail });
      ctx.emit("vault.item_deleted", `vault_item/${str(it, "id")}`, { itemId: str(it, "id") }, { vis: "participants" });
    };
    for (const p of rows.slice(1)) {
      const it = item(ctx, str(p, "itemId"))!;
      ctx.db.run(`DELETE FROM vault_provider_alias WHERE "handle" = ?`, str(it, "handle"));
      ctx.db.run(`INSERT INTO vault_provider_alias ("handle", "providerId", "at") VALUES (?, ?, ?)`, str(it, "handle"), str(keep, "id"), ctx.now());
      ctx.db.run(`UPDATE vault_provider SET "deleted_at" = ? WHERE "id" = ?`, ctx.now(), str(p, "id"));
      ctx.emit("provider.removed", `entity/${str(p, "id")}`, { providerId: str(p, "id") }, { vis: "participants" });
      if (str(it, "id") !== str(bestItem, "id")) gone(it, `The same account signed in again; ${handle} keeps it.`);
      folded++;
    }
    if (str(bestItem, "id") !== str(keepItem, "id")) {
      // the older credential steps aside under a handle of its own, and the newest takes the handle and the name everything already holds
      // it keeps a name of its own too, so it can be restored from the Trash beside the row that kept the account
      patchMeta(ctx, str(keepItem, "id"), { handle: uniqueHandle(ctx, `${name} replaced`, str(keepItem, "id")), name: `${name}, older sign-in` });
      gone(keepItem, `A newer sign-in of the same account took over ${handle}.`);
      const nameFree = !rowsOf(ctx.db.all(`SELECT * FROM vault_meta WHERE "folderId" = ?`, str(bestItem, "folderId"))).some((r) => live(r) && str(r, "id") !== str(bestItem, "id") && str(r, "name").toLowerCase() === name.toLowerCase());
      patchMeta(ctx, str(bestItem, "id"), { handle, ...(nameFree ? { name } : {}) });
      record(ctx, str(bestItem, "id"), "edited", { detail: `Took over ${handle}: the newest sign-in of this account.` });
      ctx.db.run(`UPDATE vault_provider SET "itemId" = ?, "state" = ? WHERE "id" = ?`, str(bestItem, "id"), "ok", str(keep, "id"));
      ctx.emit("provider.updated", `entity/${str(keep, "id")}`, { providerId: str(keep, "id"), state: "ok" }, { vis: "participants" });
    }
    ctx.log.info("vault.signins_folded", { providerId: str(keep, "id"), providerKey: str(keep, "providerKey"), folded: rows.length - 1 });
  }
  return folded;
}
