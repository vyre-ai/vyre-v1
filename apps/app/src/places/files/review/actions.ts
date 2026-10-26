// What a press does on the review surfaces: one capability call, then the answer in words. A failed write never throws into a click; it becomes a line the surface shows.
import type { CapMap } from "../../../../../../generated/types.ts";
import { errorWords } from "./model.ts";

export type Call = (cap: string, input: unknown) => Promise<unknown>;
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

async function run<C extends keyof CapMap>(call: Call, cap: C, input: CapMap[C]["in"], what: string): Promise<Result<CapMap[C]["out"]>> {
  try { return { ok: true, value: (await call(cap, input)) as CapMap[C]["out"] }; } catch (e) { return { ok: false, error: errorWords(e, what) }; }
}

export interface ApproveArgs { changesetId: string; message: string; push: boolean; key: string }

/** The input of changesets.approve: the message is left out when empty, push is always said so the kernel never guesses. */
export function approveInput(a: ApproveArgs): CapMap["changesets.approve"]["in"] {
  const message = a.message.trim();
  return { changesetId: a.changesetId, ...(message ? { message } : {}), push: a.push, idempotencyKey: a.key };
}

/** Approve and commit. A commit the kernel declined because files moved on comes back as the files to look at. */
export async function approveChangeset(call: Call, a: ApproveArgs): Promise<Result<CapMap["changesets.approve"]["out"]>> {
  const r = await run(call, "changesets.approve", approveInput(a), "approve");
  if (r.ok && !r.value.approved) {
    const n = r.value.conflicts.length;
    return { ok: false, error: n ? `${n} ${n === 1 ? "file" : "files"} changed since. Open ${r.value.conflicts[0]} to choose what to keep.` : "These changes were not approved." };
  }
  return r;
}

export function requestChanges(call: Call, changesetId: string, note: string): Promise<Result<CapMap["changesets.request_changes"]["out"]>> {
  const n = note.trim();
  return run(call, "changesets.request_changes", { changesetId, ...(n ? { note: n } : {}) }, "send this back");
}

export function discardChangeset(call: Call, changesetId: string): Promise<Result<CapMap["changesets.discard"]["out"]>> {
  return run(call, "changesets.discard", { changesetId }, "discard");
}

export function reviewExternally(call: Call, changesetId: string, actorId?: string): Promise<Result<CapMap["changesets.review_externally"]["out"]>> {
  return run(call, "changesets.review_externally", { changesetId, ...(actorId ? { actorId } : {}) }, "ask for a review");
}

export function restoreVersion(call: Call, fileId: string, versionId: string): Promise<Result<CapMap["files.restore_version"]["out"]>> {
  return run(call, "files.restore_version", { fileId, versionId }, "restore");
}

export function nameVersion(call: Call, fileId: string, versionId: string, name: string): Promise<Result<CapMap["files.name_version"]["out"]>> {
  return run(call, "files.name_version", { fileId, versionId, name: name.trim() }, "name this version");
}

export interface SaveArgs { fileId: string; text: string; baseVersion: number; reason: string; acceptWarnings: boolean }

/** Save with the version the draft was made from, so a save over someone else's newer one is refused instead of lost. */
export function saveFile(call: Call, a: SaveArgs): Promise<Result<CapMap["files.save"]["out"]>> {
  const reason = a.reason.trim();
  return run(call, "files.save", { fileId: a.fileId, text: a.text, baseVersion: a.baseVersion, ...(reason ? { reason } : {}), ...(a.acceptWarnings ? { acceptWarnings: true } : {}) }, "save");
}

export function switchBranch(call: Call, folderId: string, name: string): Promise<Result<CapMap["git.branch"]["out"]>> {
  return run(call, "git.branch", { folderId, action: "switch", name }, "switch branch");
}

export function pushBranch(call: Call, folderId: string, key: string, branch?: string): Promise<Result<CapMap["git.push"]["out"]>> {
  return run(call, "git.push", { folderId, ...(branch ? { branch } : {}), idempotencyKey: key }, "push");
}

export function pullBranch(call: Call, folderId: string): Promise<Result<CapMap["git.pull"]["out"]>> {
  return run(call, "git.pull", { folderId }, "pull");
}

export function syncFolder(call: Call, folderId: string, key: string): Promise<Result<CapMap["git.sync"]["out"]>> {
  return run(call, "git.sync", { folderId, idempotencyKey: key }, "sync");
}

export function initRepo(call: Call, folderId: string): Promise<Result<CapMap["git.init"]["out"]>> {
  return run(call, "git.init", { folderId }, "start a repository");
}

export function commitChanges(call: Call, folderId: string, message: string, key: string, paths?: readonly string[]): Promise<Result<CapMap["git.commit"]["out"]>> {
  return run(call, "git.commit", { folderId, message: message.trim(), ...(paths ? { paths: [...paths] } : {}), idempotencyKey: key }, "commit");
}

export function acceptSuggestion(call: Call, suggestionId: string): Promise<Result<CapMap["agents.suggestion.accept"]["out"]>> {
  return run(call, "agents.suggestion.accept", { suggestionId }, "apply the suggestion");
}

export function dismissSuggestion(call: Call, suggestionId: string): Promise<Result<CapMap["agents.suggestion.dismiss"]["out"]>> {
  return run(call, "agents.suggestion.dismiss", { suggestionId }, "dismiss the suggestion");
}

/** The text of two versions of a file, for the whole-document view; null when either cannot be read as text. */
export async function readTexts(call: Call, fileId: string, from: string, to: string): Promise<{ from: string; to: string } | null> {
  try {
    const one = async (versionId: string): Promise<string | null> => {
      const out = (await call("files.read", { fileId, versionId, as: "text" })) as CapMap["files.read"]["out"];
      return typeof out.text === "string" && !out.truncated ? out.text : null;
    };
    const [x, y] = [await one(from), await one(to)];
    return x === null || y === null ? null : { from: x, to: y };
  } catch {
    return null;
  }
}
