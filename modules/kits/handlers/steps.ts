// kits file step (spec 2.21, 2.16): a Kit item whose apply step is { cap: "file.put", input: { path, content } } puts a text file at a tree path, making any missing folders on the
// way. This is how a Kit ships a runbook: a Markdown file in a folder, which a plain capability step cannot name because a step cannot use the id an earlier step made.
// It is applied as the installing person through files.resolve, files.folder.create and files.create, so permissions, the Gate and audit hold as for every Kit step.
// Idempotent: a folder that exists is reused, a file that exists is left as it is (a person may have edited it), and the same step twice changes nothing.
// The first path segment must be a root of the tree that exists (Projects, Agents, and so on); a Kit cannot make a root.

import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { ErrorCode } from "../../../packages/contracts/src/types.ts";
import { fail as hostFail } from "../../../host/src/routes/errors.ts";

export const FILE_STEP_CAP = "file.put";
export const MAX_FILE_BYTES = 200_000;
const MAX_SEGMENTS = 8;
const MAX_NAME = 120;

export interface FileStepInput { path: string; content: string }

export const isFileStep = (step: { cap: string }): boolean => step.cap === FILE_STEP_CAP;

function fail(ctx: Ctx, code: ErrorCode, message: string, details?: Record<string, unknown>): never {
  throw hostFail(code, ctx.trace.traceId, { message, ...(details ? { details } : {}) });
}

/** Checks the step's input and returns its path as segments. Returns a problem sentence instead when it is not valid (used by checkKit as well). */
export function checkFileStep(input: unknown): { segments: string[]; problem: null } | { segments: null; problem: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { segments: null, problem: "a file step is { path, content }" };
  const o = input as Record<string, unknown>;
  if (typeof o.path !== "string" || typeof o.content !== "string") return { segments: null, problem: "a file step is { path, content } with text for both" };
  if (new TextEncoder().encode(o.content).length > MAX_FILE_BYTES) return { segments: null, problem: `the content is at most ${MAX_FILE_BYTES} bytes` };
  const segments = o.path.split("/");
  if (segments.length < 2 || segments.length > MAX_SEGMENTS) return { segments: null, problem: `the path is a root and 1 to ${MAX_SEGMENTS - 1} more names, such as Projects/Runbooks/new-matter.md` };
  for (const s of segments) {
    // eslint-disable-next-line no-control-regex
    if (s === "" || s === "." || s === ".." || s.length > MAX_NAME || /[\\\u0000-\u001f]/.test(s) || s !== s.trim()) return { segments: null, problem: `"${s}" is not a valid name in a path` };
  }
  return { segments, problem: null };
}

const codeOf = (e: unknown): string => String((e as { error?: { code?: unknown } } | null)?.error?.code ?? "");

async function resolveId(ctx: Ctx, path: string, kind: "file" | "folder"): Promise<string | null> {
  try {
    const r = (await ctx.call("files.resolve", { path })) as { kind?: string; fileId?: string; folderId?: string };
    if (r.kind !== kind) fail(ctx, "validation.precondition_failed", `${path} is a ${r.kind ?? "different kind of item"}, not a ${kind}.`);
    const id = kind === "file" ? r.fileId : r.folderId;
    return typeof id === "string" ? id : null;
  } catch (e) {
    if (codeOf(e) === "validation.not_found") return null;
    throw e;
  }
}

/** Puts the file. Returns its id and whether this call made it. */
export async function runFileStep(ctx: Ctx, input: unknown): Promise<{ fileId: string; created: boolean }> {
  const checked = checkFileStep(input);
  if (checked.segments === null) fail(ctx, "validation.bad_input", checked.problem);
  const { segments } = checked;
  const path = segments.join("/");
  const content = (input as FileStepInput).content;

  const have = await resolveId(ctx, path, "file");
  if (have !== null) return { fileId: have, created: false };

  // the folders, from the root down
  let parent = await resolveId(ctx, segments[0] as string, "folder");
  if (parent === null) fail(ctx, "validation.precondition_failed", `${segments[0]} is not a folder in the file tree, and a Kit cannot make one.`);
  for (let i = 1; i < segments.length - 1; i++) {
    const at = segments.slice(0, i + 1).join("/");
    let id = await resolveId(ctx, at, "folder");
    if (id === null) {
      try {
        const made = (await ctx.call("files.folder.create", { parentId: parent, name: segments[i], idempotencyKey: `kit-folder:${at}` })) as { folder?: { folderId?: string } };
        id = made.folder?.folderId ?? null;
      } catch (e) {
        if (codeOf(e) !== "validation.duplicate") throw e;
        id = await resolveId(ctx, at, "folder");   // made by someone between the check and the create
      }
    }
    if (id === null) fail(ctx, "internal.unexpected", `The folder ${at} was not created.`);
    parent = id;
  }

  const name = segments[segments.length - 1] as string;
  try {
    const made = (await ctx.call("files.create", { folderId: parent, name, content: { text: content }, idempotencyKey: `kit-file:${path}` })) as { file?: { fileId?: string } };
    if (typeof made.file?.fileId === "string") return { fileId: made.file.fileId, created: true };
  } catch (e) {
    if (codeOf(e) !== "validation.duplicate") throw e;
    const again = await resolveId(ctx, path, "file");
    if (again !== null) return { fileId: again, created: false };
  }
  return fail(ctx, "internal.unexpected", `The file ${path} was not created.`);
}
