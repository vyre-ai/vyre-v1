// "Can an agent working for this person use a key kept here?" asked of a list of Vault folders, for the connect card's Kept in menu and the Vault's share sheet. It asks the one shared check (access.clears, label
// against clearance) and never answers for it: this file only asks it once per folder and adds the folders the server made for itself, which are not the person's to choose at all. Nothing here decides access:
// the Vault and the access module still do, on every use.
import type { VaultReqCtx } from "./projections.ts";
import { asRow } from "./projections.ts";

export interface FolderRef {
  id: string;
  name: string;
  scope: "mine" | "shared";
  owner?: string;
  parentId?: string;
}

/** A folder a service made for itself (a company key, the sign-in secret): the server's, never offered as a place to keep a key. */
export const madeByService = (f: FolderRef): boolean =>
  f.scope === "shared" && !f.parentId && String(f.owner ?? "").startsWith("svc_");

/** For each folder: may the principal use a key kept there? A person's own Mine always is: the agent works as them. A question the access module cannot answer reads as yes: storing is refused again where it cannot work. */
export async function keptUsable(
  ctx: VaultReqCtx,
  principal: { kind: string; id: string } | undefined,
  folders: readonly FolderRef[],
): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  await Promise.all(
    folders.map(async (f) => {
      if (f.scope === "mine") return void out.set(f.id, true);
      if (madeByService(f)) return void out.set(f.id, false);
      if (!principal) return void out.set(f.id, true);
      try {
        const got = asRow(await ctx.call("access.clears", { principal, target: { type: "vault_folder", id: f.id } }));
        out.set(f.id, got?.["clears"] !== false);
      } catch {
        out.set(f.id, true);
      }
    }),
  );
  return out;
}
