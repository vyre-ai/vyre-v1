// What the two setup pages do when a button is pressed, as plain functions over `run` (the Console's action runner). The pages only hold what the person typed and draw the answer, so
// every step of the connection is tested here against a fake runner.
import { CONNECTIONS_FOLDER, shortScope } from "./model.ts";
import type { MemberRow } from "./model.ts";

export type Run = <T = unknown>(cap: string, input: unknown, success: string | ((out: T) => string | Promise<string>)) => Promise<T | undefined>;

export interface FolderLike { id: string; yourLevel: string; name?: string | undefined }
export interface Checked { ok: boolean; missing: readonly string[]; detail?: string | undefined }

/**
 * Puts a pasted secret in the Vault under `name` (replacing the field when the item already exists) and answers whether it is stored. The secret goes in one call and is not kept:
 * the caller empties its box when this answers true. These keys can read every mailbox in the firm, so they live in their own shared folder (CONNECTIONS_FOLDER) and the folder and the item are
 * labelled Restricted: a Member's role carries Edit over the whole Space, and only Owner and Admin are cleared for Restricted, so a Member and every agent can neither list, use nor change them.
 * The folder is labelled before the item goes in, and the item after, so the value is never in an open place.
 */
export async function storeInVault(run: Run, o: { name: string; handle: string; text: string; folders: readonly FolderLike[]; existingItemId?: string | undefined }): Promise<boolean> {
  const fields = [{ key: "key", value: o.text, secret: true }];
  const stored = `Stored in the Vault as ${o.handle}. It will not be shown again.`;
  const restrict = (type: "vault_folder" | "vault_item", id: string): Promise<unknown> => run("access.labels.set", { resource: { type, id }, label: "restricted" }, stored);
  if (o.existingItemId) {
    if ((await restrict("vault_item", o.existingItemId)) === undefined) return false;
    return (await run("vault.item.update", { itemId: o.existingItemId, fieldsSet: fields }, stored)) !== undefined;
  }
  let folderId = o.folders.find((f) => f.name === CONNECTIONS_FOLDER && (f.yourLevel === "edit" || f.yourLevel === "manage"))?.id;
  if (!folderId) {
    const made = await run<{ folder: { id: string } }>("vault.folders.create", { name: CONNECTIONS_FOLDER, scope: "shared", idempotencyKey: "" }, `Made the shared Vault folder ${CONNECTIONS_FOLDER}.`);
    folderId = made?.folder.id;
    if (!folderId) return false;
  }
  if ((await restrict("vault_folder", folderId)) === undefined) return false;
  const put = await run<{ item: { id: string } }>("vault.item.put", { folderId, name: o.name.replace(/^#/, ""), kind: "other", fields, idempotencyKey: "" }, stored);
  if (put === undefined) return false;
  return (await restrict("vault_item", put.item.id)) !== undefined;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function connectedLine(mapped: number, connected: number): string {
  return `Connected. ${plural(mapped, "member is", "members are")} matched and ${plural(connected, "mail connection is", "mail connections are")} waiting to be accepted.`;
}

export function memberToggle(run: Run, cap: "google.dwd.set_excluded" | "ms.consent.set_excluded", m: MemberRow): Promise<unknown> {
  return run(cap, { email: m.email, excluded: !m.excluded }, m.excluded ? `${m.email} is included again.` : `${m.email} is excluded. Their mail is never read.`);
}

// ---- Google

export function googleChecked(out: { ok: boolean; scopesMissing: readonly string[]; detail?: string | undefined }): Checked {
  return { ok: out.ok, missing: out.scopesMissing, detail: out.detail };
}
export function googleCheckLine(out: { ok: boolean; email?: string | undefined; scopesMissing: readonly string[]; detail?: string | undefined }, admin: string): string {
  if (out.ok) return `Google answered for ${out.email ?? admin}. Every scope is allowed.`;
  if (out.scopesMissing.length > 0) return `Missing in the Admin console: ${out.scopesMissing.map(shortScope).join(", ")}.`;
  return out.detail ?? "Google did not accept the check.";
}

// ---- Microsoft

export function microsoftChecked(out: { ok: boolean; missingPermissions: readonly string[]; detail?: string | undefined }): Checked {
  return { ok: out.ok, missing: out.missingPermissions, detail: out.detail };
}
export function microsoftCheckLine(out: { ok: boolean; missingPermissions: readonly string[]; detail?: string | undefined }): string {
  if (out.ok) return "Microsoft answered. Consent is given and the app can reach your members' mailboxes.";
  if (out.missingPermissions.length > 0) return `Not yet consented: ${out.missingPermissions.join(", ")}. ${out.detail ?? ""}`.trim();
  return out.detail ?? "Microsoft did not accept the check.";
}

export function matchPerson(run: Run, cap: "google.dwd.map_member" | "ms.consent.map_member", email: string, userId: string): Promise<unknown> {
  return run(cap, { email: email.trim().toLowerCase(), userId, idempotencyKey: "" }, (out: { connected?: boolean }) => (out.connected ? `Matched ${email}. Their mail and calendar will start to come in.` : `Matched ${email}.`));
}

export function unmatchPerson(run: Run, cap: "google.dwd.map_member" | "ms.consent.map_member", email: string): Promise<unknown> {
  return run(cap, { email, idempotencyKey: "" }, `${email} is no longer matched to a person.`);
}
