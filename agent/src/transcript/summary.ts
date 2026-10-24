// from vyre 0.6.9 core/switchboard/translate.js@dbd2dfbab (describe, toolFields, cut)
// A tool call as one line a person can judge: what it did, never its whole input (a Write's content or an Edit's replacement can be the size of a file and may hold anything).
import { redact } from "./sanitize.ts";

const CUT = 200;

export function cut(v: unknown, n: number = CUT): string {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** A string redacted, then capped. Whitespace is kept. */
export function clip(v: unknown, n: number): string {
  const s = typeof v === "string" ? redact(v).text : "";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** What a tool call does, for a step's icon and verb. Anything unknown is "other". */
export const TOOL_KINDS = ["read", "edit", "write", "run", "search", "fetch", "mcp", "task", "other"] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];
const KIND_OF: Readonly<Record<string, ToolKind>> = {
  Read: "read", Write: "write", Edit: "edit", MultiEdit: "edit", NotebookEdit: "edit", Grep: "search", Glob: "search", Bash: "run", WebFetch: "fetch", WebSearch: "fetch", Task: "task", Agent: "task",
};

export function toolKind(name: string, hint?: string): ToolKind {
  const h = TOOL_KINDS.find((k) => k === hint);
  if (h) return h;
  return KIND_OF[name] ?? (name.startsWith("mcp__") ? "mcp" : "other");
}

/** A tool call as one line. A command can carry a token, and the summary is shown on every device, so it is redacted first. */
export function describe(name: string, input: unknown): string {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (name === "Bash") return cut(clip(String(i["command"] ?? ""), 4000));
  if (["Write", "Edit", "MultiEdit", "Read", "NotebookEdit"].includes(name)) return `${name} ${cut(i["file_path"] ?? i["notebook_path"] ?? "")}`.trim();
  if (name === "WebFetch") return `fetch ${cut(clip(i["url"], 500))}`;
  if (name === "WebSearch") return `search ${cut(clip(i["query"], 500))}`;
  if (name === "Glob" || name === "Grep") return `${name} ${cut(i["pattern"])}${i["path"] ? ` in ${cut(i["path"], 80)}` : ""}`;
  const first = Object.entries(i).find(([, v]) => typeof v === "string");
  return cut(clip(`${name}${first ? ` ${first[0]}: ${String(first[1])}` : ""}`, 600));
}
