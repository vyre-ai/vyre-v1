// @reads /modules/mounts/migrations/0001_mounts_core.sql
// mounts (lane L4). The host loads generated stub handlers while status is stub, and this module once the manifest is live.

export { handlers } from "./handlers/index.ts";
export { inline, consumers, projections } from "./projections.ts";

/**
 * Redaction for AI: the Vyre file or folder a provider's item is mounted as (Drive file id, OneDrive or SharePoint item id), so the read gate can hold a connector call that reaches a mounted file to
 * that file's Agent access and redactions (host/src/seams/agent-read.ts). An item no mount holds answers nothing.
 */
export const hostCalls = {
  "mounts.item_for_remote": (ctx: { db: { all(sql: string, ...a: unknown[]): unknown[] } }, i: { remoteId?: unknown }): { fileId: string | null; folderId: string | null } => {
    const id = typeof i?.remoteId === "string" ? i.remoteId : "";
    if (!id) return { fileId: null, folderId: null };
    let rows: Record<string, unknown>[] = [];
    try { rows = ctx.db.all(`SELECT "file_id", "folder_id" FROM mounts_item WHERE "remote_id" = ? AND "deleted" = 0`, id) as Record<string, unknown>[]; } catch { rows = []; }
    const r = rows[0];
    return { fileId: typeof r?.["file_id"] === "string" ? r["file_id"] as string : null, folderId: typeof r?.["folder_id"] === "string" ? r["folder_id"] as string : null };
  },
};
