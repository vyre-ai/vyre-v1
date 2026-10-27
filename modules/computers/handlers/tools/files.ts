// The Files tools of an agent computer (spec 2.7, 2.16): list, read, write, move and delete in the agent's Files folder as the computer sees it, bound at ~/Vyre. The folder is a mirror of the agent's folder in
// the Files module, kept together by the daemon as the agent (handlers/home.ts): a file written here reaches Files within seconds and a change in Files reaches the computer within seconds. Files is the
// source of truth, so a conflict keeps Files' version at the path and the computer's beside it. The path rules are checked here, before agentd, and agentd checks them again at the folder.
// Delete asks the Gate unless the actor is a person (manifest); the folder's own review rules (ruling 33) apply to the write the same way they do to any other writer.
import { raise } from "../../projections.ts";
import type { CompCtx } from "../../projections.ts";
import { clip, defined, run, shape } from "./common.ts";

interface Base { computerId?: string | undefined }
const MAX_PATH = 1024;
/** One tool call travels to agentd as one argument of `docker exec` (the kernel allows 128 KB for it). Larger files go through the Files module, which is made for them. */
const MAX_WRITE = 90_000;

/** A path inside the Files folder: relative, no `..`, no backslash, no NUL. Returns it without a leading `./` or trailing slash; "" is the folder itself. */
export function folderPath(ctx: CompCtx, p: unknown, opts: { allowRoot?: boolean } = {}): string {
  if (typeof p !== "string") raise(ctx, "validation.bad_input", "Give a path in the Files folder.");
  if (p.length > MAX_PATH || p.includes("\0") || p.includes("\\")) raise(ctx, "validation.bad_input", "That is not a path in the Files folder.");
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p) || p.startsWith("~")) raise(ctx, "validation.bad_input", "A path in the Files folder is relative to it: no leading slash.");
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  if (parts.includes("..")) raise(ctx, "validation.bad_input", "A path cannot leave the Files folder.");
  const clean = parts.join("/");
  if (clean === "" && opts.allowRoot !== true) raise(ctx, "validation.bad_input", "Name a file or a folder, not the whole Files folder.");
  return clean;
}

export async function list(ctx: CompCtx, input: Base & { path?: string }) {
  const dir = input.path === undefined ? "" : folderPath(ctx, input.path, { allowRoot: true });
  const out = await run(ctx, input, { name: "computer_files_list", caption: null }, { path: dir });
  const got = shape(ctx, "computer_files_list", out, { entries: "a" });
  got["entries"] = (got["entries"] as unknown[]).map((e) => {
    const row = shape(ctx, "computer_files_list", e as Record<string, unknown>, { name: "s", kind: "s", size: "n?", modifiedAt: "n?" });
    if (row["kind"] !== "file" && row["kind"] !== "folder") raise(ctx, "provider.unavailable", "The computer's computer_files_list answer has an entry that is neither a file nor a folder.");
    return row;
  });
  return got;
}

export async function read(ctx: CompCtx, input: Base & { path: string; maxBytes?: number }) {
  const path = folderPath(ctx, input.path);
  const out = await run(ctx, input, { name: "computer_files_read", caption: null }, { path, maxBytes: input.maxBytes ?? 1_000_000 });
  const got = shape(ctx, "computer_files_read", out, { content: "s", encoding: "s", truncated: "b" });
  if (got["encoding"] !== "utf8" && got["encoding"] !== "base64") raise(ctx, "provider.unavailable", "The computer's computer_files_read answer has an encoding it should not.");
  return got;
}

export async function write(ctx: CompCtx, input: Base & { path: string; content: string; encoding?: "utf8" | "base64"; mode?: "create" | "overwrite" | "append" }) {
  const path = folderPath(ctx, input.path);
  if (typeof input.content !== "string") raise(ctx, "validation.bad_input", "Give the content to write.");
  const encoding = input.encoding ?? "utf8";
  const size = encoding === "base64" ? Math.floor((input.content.length * 3) / 4) : new TextEncoder().encode(input.content).length;
  if (size > MAX_WRITE) raise(ctx, "validation.bad_input", "That file is too large to write through a tool call (90 KB). Save it with the Files tools of the Files module.", { bytes: size });
  if (encoding === "base64" && !/^[A-Za-z0-9+/]*={0,2}$/.test(input.content)) raise(ctx, "validation.bad_input", "The content is not base64.");
  const out = await run(ctx, input, { name: "computer_files_write", caption: () => `Wrote ${clip(path, 60)}` }, defined({ path, content: input.content, encoding, mode: input.mode ?? "overwrite" }));
  return shape(ctx, "computer_files_write", out, { ok: "b", versionId: "s?" });
}

export async function move(ctx: CompCtx, input: Base & { from: string; to: string }) {
  const from = folderPath(ctx, input.from);
  const to = folderPath(ctx, input.to);
  if (from === to) raise(ctx, "validation.bad_input", "The file is already there.");
  const out = await run(ctx, input, { name: "computer_files_move", caption: () => `Moved ${clip(from, 40)} to ${clip(to, 40)}` }, { from, to });
  return shape(ctx, "computer_files_move", out, { ok: "b" });
}

export async function remove(ctx: CompCtx, input: Base & { path: string }) {
  const path = folderPath(ctx, input.path);
  const out = await run(ctx, input, { name: "computer_files_delete", caption: () => `Deleted ${clip(path, 60)}` }, { path });
  return shape(ctx, "computer_files_delete", out, { ok: "b" });
}
