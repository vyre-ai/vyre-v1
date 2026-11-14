// "Can an agent working for this person use a key kept here?" asked of a list of Vault folders, for the connect card's Kept in menu and the Vault's share sheet.
// This is the one seam to the shared label-against-clearance check (lane f-keyreach2, `access.clears`). Until that capability answers, a folder the server alone uses is the one folder known not
// to be usable; when it answers, its word is the only word. Nothing here decides access: the Vault and the access module still do, on every use.
import { isServerOnlyFolder } from "../../lib/company-keys.ts";
import type { VaultReqCtx } from "./projections.ts";
import { asRow } from "./projections.ts";

export interface FolderRef {
  id: string;
  name: string;
  scope: "mine" | "shared";
}

/** For each folder: may the agent use a key kept there? A person's own Mine always is: the agent works as them. */
export async function keptUsable(
  ctx: VaultReqCtx,
  agentId: string | undefined,
  folders: readonly FolderRef[],
): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  const shared = folders.filter((f) => f.scope === "shared");
  for (const f of folders) if (f.scope === "mine") out.set(f.id, true);
  let answered: Map<string, boolean> | null = null;
  if (agentId && shared.length > 0) {
    try {
      const got = asRow(
        await ctx.call("access.clears", {
          agent: agentId,
          resources: shared.map((f) => ({ type: "vault_folder", id: f.id })),
        }),
      );
      const rows = Array.isArray(got?.["clears"]) ? (got["clears"] as unknown[]) : [];
      answered = new Map(
        rows.map((r) => {
          const o = asRow(r);
          return [String(o?.["id"] ?? ""), o?.["clears"] === true] as const;
        }),
      );
    } catch {
      answered = null;
    }
  }
  for (const f of shared) out.set(f.id, answered?.has(f.id) ? answered.get(f.id)! : !isServerOnlyFolder(f.name));
  return out;
}
