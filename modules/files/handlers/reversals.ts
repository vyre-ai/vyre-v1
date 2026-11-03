// Learn from an undo in Files (lib/reversal.ts, memory.corrections.record): bringing back what an agent deleted, putting back an earlier version of what it wrote, moving back what it moved, reverting a
// change it proposed in a changeset, discarding its proposal.
import { isAgentId } from "../../../lib/reversal.ts";

const fileOf = (i: { fileId: string }): { type: string; id: string } => ({ type: "file", id: i.fileId });
const fileName = (o: { file?: { name?: string } }): string => (o?.file?.name ? ` "${o.file.name}"` : "");
const folderName = (o: { folder?: { name?: string } }): string => (o?.folder?.name ? ` "${o.folder.name}"` : "");
/**
 * A person bringing back what an agent deleted, putting back an earlier version of what it wrote, moving back what it moved, reverting a change it proposed or discarding its proposal teaches that agent
 * (lib/reversal.ts, memory.corrections.record). A changeset keeps its author, so that one needs no event lookup.
 */
export const REVERSALS = {
  "files.restore": { subject: fileOf, types: ["file.deleted"], was: (_i: unknown, o: never) => `deleted the file${fileName(o)}` },
  "files.folder.restore": { subject: (i: { folderId: string }) => ({ type: "folder", id: i.folderId }), types: ["folder.deleted"], was: (_i: unknown, o: never) => `deleted the folder${folderName(o)}` },
  "files.restore_version": { subject: fileOf, types: ["file.version_added", "file.created"], was: (_i: unknown, o: never) => `changed the file${fileName(o)}` },
  "files.move": {
    subject: fileOf, types: ["file.moved"], match: (e: { payload: Record<string, unknown> }, i: { toFolderId?: string }) => e.payload["fromFolderId"] === i.toFolderId,
    was: (_i: unknown, o: never) => `moved the file${fileName(o)}`,
  },
  "changesets.revert_change": { actOf: (ctx: never, i: { changesetId: string }) => changesetAuthor(ctx, i.changesetId), was: (i: { path?: string }) => `changed ${i.path ? `"${i.path}"` : "a file"} and proposed it for review` },
  "changesets.discard": { actOf: (ctx: never, i: { changesetId: string }) => changesetAuthor(ctx, i.changesetId), how: "refuse" as const, was: () => "proposed changes to files for review" },
};

function changesetAuthor(ctx: { db: { all(sql: string, ...args: unknown[]): unknown[] } }, id: string): { agentId: string; ref: string; threadId?: string } | null {
  const row = (ctx.db.all("SELECT id, author, thread_id FROM files_changeset WHERE id = ?", id) as Array<{ id: string; author: string; thread_id: string | null }>)[0];
  if (!row || !isAgentId(row.author)) return null;
  return { agentId: row.author, ref: row.id, ...(row.thread_id ? { threadId: row.thread_id } : {}) };
}
