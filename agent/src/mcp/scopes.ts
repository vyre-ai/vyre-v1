// What an outside actor's scopes allow (ARCH 6.7: read, post in threads, read changesets, write on a branch with approval; Vault values are never available).
// This narrows the tool list and refuses calls before they reach the pipeline. It never widens anything: the pipeline still intersects the actor's access with the person's.
import type { ToolDef } from "../tools/types.ts";
import type { Scopes } from "./types.ts";

/** Executors that run on a computer, and the Vault: not for an outside tool, whatever its scopes say. */
const NEVER: ReadonlySet<string> = new Set(["vault", "terminal", "computer"]);
/** The posts a "post in threads" scope allows. */
export const POST_CAPS: ReadonlySet<string> = new Set(["chat.post", "chat.thread"]);

/** Finding tools is not a power: every actor may ask what exists (the results are still cut to what its scopes allow). */
const ALWAYS: ReadonlySet<string> = new Set(["mcp.tool.search", "mcp.tool.describe", "mcp.toolsets.list"]);

export type ScopeName = keyof Scopes;

/** The scope that lets this tool through, or null when no scope can. */
export function scopeFor(t: ToolDef): ScopeName | null {
  if (NEVER.has(t.toolset) || t.local !== "none") return null;
  if (POST_CAPS.has(t.cap)) return "post";
  if (t.effects === "read") return t.cap.startsWith("changesets.") ? "readChangesets" : "read";
  if (t.toolset === "files" && t.effects === "write") return "writeBranch";
  return null;
}

/** Read scope covers every read tool, so a changeset reader without `read` gets only changesets. */
export function scopeAllows(s: Scopes, t: ToolDef): boolean {
  if (ALWAYS.has(t.cap)) return true;
  const need = scopeFor(t);
  if (need === null) return false;
  if (need === "read") return s.read;
  if (need === "readChangesets") return s.readChangesets || s.read;
  return s[need];
}
