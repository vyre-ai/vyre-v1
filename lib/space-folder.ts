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
