// Where a key shared with the whole Space goes when nobody chose a folder (owner, 3 Nov: "Choose the shared folder to keep it in" was a dead end). One rule for the server and the app:
// the Space's one shared folder the person can add to (not one Vyre keeps for its own wiring), else "AI accounts", made on first use and shared with Everyone at Use. The Space AI key's own Restricted folder is never a choice.

export const AI_ACCOUNTS = "AI accounts";
/** The Restricted folder the Space AI key lives in (modules/vault/handlers/space-key.ts). */
export const SPACE_KEY_FOLDER = "Space AI key";
/** Folders Vyre keeps for its own wiring: the company connection's secrets, the Space AI key, connections' tokens. A key the person adds never lands in one by default. */
export const SYSTEM_FOLDERS: ReadonlySet<string> = new Set([SPACE_KEY_FOLDER, "Company connections", "Connections"]);

export interface SharedFolder { id: string; name: string; canAdd: boolean }

/** The folder to use: an existing one ({ id, name }), or the default to make ({ name: "AI accounts" }; an existing "AI accounts" folder is reused). */
export function pickSpaceFolder(folders: readonly SharedFolder[]): { id?: string; name: string } {
  const open = folders.filter((f) => f.canAdd && !SYSTEM_FOLDERS.has(f.name));
  const ai = open.find((f) => f.name.toLowerCase() === AI_ACCOUNTS.toLowerCase());
  if (ai) return { id: ai.id, name: ai.name };
  if (open.length === 1) return { id: open[0]!.id, name: open[0]!.name };
  return { name: AI_ACCOUNTS };
}

// ---- one helper for every key the whole Space must reach (AI accounts, connections, skills, app hubs)

export type Call = (cap: string, input: unknown) => Promise<unknown>;
/** The Everyone group every member is in (modules/access/projections.ts EVERYONE). */
export const EVERYONE_GROUP = "grp_everyone";

/** Words for a folder that was made, or found, but could not be shared with the Space. */
export const NOT_SHARED = "The key was saved, but its folder could not be shared with everyone in the Space, so only you can use it. Share the folder from the Vault, or ask an owner or admin.";

interface ListedFolder { id: string; name: string; scope: string; yourLevel?: string; owner?: string }

/**
 * The Shared folder a Space-wide key goes in, shared with Everyone at Use so every member's call can fill it. `name` is the folder this kind of key lives in ("Connections", "Skills",
 * "AI accounts"): an existing one of that name the caller can add to is used, else for AI keys (`reuseOpen`) pickSpaceFolder's rule, else it is made. A folder that cannot be shared refuses
 * with NOT_SHARED, except in a Personal Space, where there is nobody to share with.
 */
export async function ensureSpaceFolder(call: Call, o: { name: string; idem: string; reuseOpen?: boolean }): Promise<string> {
  const folders = ((await call("vault.folders.list", { scope: "shared" })) as { folders: ListedFolder[] }).folders.filter((f) => f.scope === "shared");
  const canAdd = (f: ListedFolder): boolean => f.yourLevel === undefined || f.yourLevel === "edit" || f.yourLevel === "manage";
  const named = folders.find((f) => canAdd(f) && f.name.toLowerCase() === o.name.toLowerCase());
  const picked = named ? { id: named.id } : o.reuseOpen ? pickSpaceFolder(folders.map((f) => ({ id: f.id, name: f.name, canAdd: canAdd(f) }))) : {};
  const id = picked.id ?? String(((await call("vault.folders.create", { name: o.name, scope: "shared", idempotencyKey: `${o.idem}:space-folder` })) as { folder: { id: string } }).folder.id);
  // a folder of ours made before this (shared with nobody) is shared now; sharing an already shared folder again changes nothing
  if (picked.id === undefined || named) await shareWithEveryone(call, id, o.idem);
  return id;
}

/** Share a folder with Everyone at Use. A Personal Space has nobody else: nothing to do there. Anywhere else a refusal is said, not swallowed. */
export async function shareWithEveryone(call: Call, folderId: string, idem: string): Promise<void> {
  try {
    await call("vault.share", { resource: { type: "vault_folder", id: folderId }, subject: { kind: "group", id: EVERYONE_GROUP }, level: "use", idempotencyKey: `${idem}:space-folder-share` });
  } catch (e) {
    const personal = await (call("spaces.get", {}) as Promise<{ space?: { kind?: string } }>).then((r) => r.space?.kind === "personal", () => false);
    if (personal) return;
    throw Object.assign(new Error(NOT_SHARED), { code: "validation.precondition_failed", cause: e });
  }
}
