// What a local tool call touches, read from its input, for decideLocal (rc.8): a delete outside the work folder always asks, a path that leaves the folder the tool is locked to is refused.
// This is a reading of the words of the call, not a sandbox: the wall itself is the sandbox and the Gate. It is meant to be cautious, never looser than what the call says.
import type { LocalFacts } from "./local.ts";
import type { ToolDef } from "./types.ts";

const DELETE = /\b(rm|rmdir|unlink|shred|trash)\b|\bfind\b[^|;&]*-delete\b|\bgit\s+clean\b/;
// a path that is not inside the work folder: absolute, the home folder, or one that climbs out with ..
const OUTSIDE = /(^|\s)(\/(?!work\/)\S*|~\S*|\$HOME\S*|\S*\.\.\/\S*|\.\.)(?=\s|$)/;
const SYSTEM = /^\/(etc|usr|bin|sbin|var|boot|sys|proc|dev|root|lib|lib64|opt|System|Library|Applications)(\/|$)/;

/** Whether a folder given as the place to work is outside what a tool may be locked to: a climb out with .. or a system folder. */
export function leavesWorkFolder(cwd: unknown): boolean {
  if (typeof cwd !== "string" || cwd === "") return false;
  return cwd.split("/").includes("..") || SYSTEM.test(cwd);
}

/** The facts of one call. Only the terminal reads them today; every other tool has none. */
export function localFacts(t: Pick<ToolDef, "name" | "local">, input: unknown): LocalFacts {
  const o = (input !== null && typeof input === "object" ? input : {}) as { command?: unknown; cwd?: unknown };
  if (t.local !== "terminal") return {};
  const facts: LocalFacts = {};
  if (leavesWorkFolder(o.cwd)) facts.outsideLockedFolder = true;
  const cmd = typeof o.command === "string" ? o.command : "";
  if (DELETE.test(cmd) && OUTSIDE.test(cmd)) facts.deletesOutsideWork = true;
  return facts;
}
