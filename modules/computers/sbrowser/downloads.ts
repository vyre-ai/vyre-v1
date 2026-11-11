// Downloads (owner decision 6 Nov): anything an agent downloads in its Space browser profile lands in that agent's Files under Downloads, never in the browser service only. Chrome saves into the profile's
// folder inside the service (browserd sets the preference and the DevTools behavior); after a step the host takes each finished file out, creates it in Files as the agent (so Files shows who downloaded it, and
// the workspace that mirrors the agent's Files folder has it), and lets the browser service drop its copy. The agent is told the path in the tool result.
import { agentInfo } from "./agentinfo.ts";
import type { CompCtx } from "../projections.ts";
import type { SpaceBrowser } from "./port.ts";

export interface SavedDownload { name: string; path: string; fileId?: string; note?: string }

/** The most a download can be to move into Files from the Space browser (browserd's own limit, profiles.ts MAX_DOWNLOAD). */
export const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const mb = (n: number): string => `${Math.max(1, Math.round(n / (1024 * 1024)))} MB`;

const MIME: Record<string, [string, string]> = {
  pdf: ["application/pdf", "pdf"], png: ["image/png", "image"], jpg: ["image/jpeg", "image"], jpeg: ["image/jpeg", "image"], gif: ["image/gif", "image"], webp: ["image/webp", "image"], svg: ["image/svg+xml", "image"],
  csv: ["text/csv", "spreadsheet"], xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "spreadsheet"], xls: ["application/vnd.ms-excel", "spreadsheet"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "document"], doc: ["application/msword", "document"], pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "presentation"],
  txt: ["text/plain", "text"], md: ["text/markdown", "markdown"], json: ["application/json", "code"], html: ["text/html", "code"], zip: ["application/zip", "archive"], mp4: ["video/mp4", "video"], mp3: ["audio/mpeg", "audio"],
};
export const typeOf = (name: string): { mime: string; kind: string } => {
  const e = /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1]?.toLowerCase() ?? "";
  const m = MIME[e];
  return m ? { mime: m[0], kind: m[1] } : { mime: "application/octet-stream", kind: "other" };
};

const folders = new Map<string, string>();
/** The agent's Downloads folder in Files, made on first use. */
export async function downloadsFolder(ctx: CompCtx, agentId: string): Promise<string | null> {
  const key = `${ctx.space}|${agentId}`;
  const have = folders.get(key);
  if (have) return have;
  const who = await agentInfo(ctx, agentId);
  let parent = who?.folderId ?? null;
  // a person's Assistant saves into that person's own Files (their Personal folder), and everyone else's agent into its own folder
  if (who?.kind === "assistant" && who.ownerId) {
    try {
      // files.tree answers an agent working for a person with that person's own Personal root (the files module's personalHolder)
      const tree = (await ctx.call("files.tree", {})) as { roots?: Array<{ key?: string; folderId?: string }> };
      const mine = tree.roots?.find((r) => r.key === "personal" && r.folderId)?.folderId;
      if (mine) parent = mine;
    } catch { /* the Assistant's own folder */ }
  }
  if (!parent) return null;
  let id: string | undefined;
  try {
    id = ((await ctx.call("files.folder.create", { parentId: parent, name: "Downloads", idempotencyKey: `sbdl-folder:${agentId}` })) as { folder?: { folderId?: string } }).folder?.folderId;
  } catch {
    // it exists already: find it
    try { id = ((await ctx.call("files.list", { folder: parent, limit: 200 })) as { folders?: Array<{ folderId: string; name: string }> }).folders?.find((f) => f.name === "Downloads")?.folderId; } catch { /* none */ }
  }
  if (id) folders.set(key, id);
  return id ?? null;
}

/** Move what the profile's browser finished downloading into the agent's Files. Never throws: a download that cannot be moved stays in the browser service and is tried at the next step. */
export async function takeDownloads(ctx: CompCtx, sb: SpaceBrowser, profileId: string, agentId: string): Promise<SavedDownload[]> {
  let rows;
  try { rows = await sb.downloads(profileId); } catch { return []; }
  if (rows.length === 0) return [];
  const folderId = await downloadsFolder(ctx, agentId);
  if (!folderId) return [];
  const saved: SavedDownload[] = [];
  for (const row of rows.slice(0, 10)) {
    // too large to move: said once, in plain words with where it is, and kept out of the list so it is not tried at every step
    if (row.size > MAX_DOWNLOAD_BYTES) {
      if (!sb.downloadKeep) continue;
      try {
        await sb.downloadKeep(profileId, row.name);
        saved.push({ name: row.name, path: `Space browser downloads/${row.name}`, note: `${row.name} is ${mb(row.size)}, more than the 20 MB a download can move into Files. It stays in this agent's Space browser and was not put in Files.` });
      } catch { /* tried at the next step */ }
      continue;
    }
    try {
      const bytes = await sb.downloadRead(profileId, row.name);
      const { mime, kind } = typeOf(row.name);
      const base64 = Buffer.from(bytes).toString("base64");
      let name = row.name;
      let made: { file?: { fileId?: string } } | undefined;
      for (let n = 1; n <= 5 && !made; n++) {
        try {
          made = (await ctx.call("files.create", { folderId, name, kind, mime, content: { base64 }, idempotencyKey: `sbdl:${profileId}:${row.name}:${row.size}:${row.at}:${n}` })) as { file?: { fileId?: string } };
        } catch (e) {
          // the name is taken by an earlier file: "report (2).pdf"
          if ((e as { error?: { code?: string } } | null)?.error?.code !== "validation.duplicate") throw e;
          const dot = row.name.lastIndexOf(".");
          name = dot > 0 ? `${row.name.slice(0, dot)} (${n + 1})${row.name.slice(dot)}` : `${row.name} (${n + 1})`;
        }
      }
      if (!made?.file?.fileId) continue;
      await sb.downloadAck(profileId, row.name);
      saved.push({ name, path: `Downloads/${name}`, fileId: made.file.fileId });
    } catch { /* stays in the browser service for the next step */ }
  }
  return saved;
}
