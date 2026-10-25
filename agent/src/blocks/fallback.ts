// The text form of a block (ARCH 6.8 rule 5): the notification pipeline, email replies and the CLI read blocks as text. A template fills `{{field}}`, a dotted path `{{to.model}}` and the length of
// a list or a string `{{steps.length}}`; anything missing is empty and the line is tidied. A block the server does not know, or a newer version of one it does, gets the generic line, which
// always carries the trace id so a person can quote it.
import type { Block, BlockDef } from "./types.ts";

const SLOT = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;

function lookup(data: unknown, path: string): string {
  let cur: unknown = data;
  for (const part of path.split(".")) {
    if (part === "length" && (Array.isArray(cur) || typeof cur === "string")) { cur = cur.length; continue; }
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return "";
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "string" || typeof cur === "number" || typeof cur === "boolean" ? String(cur) : "";
}

export function fillTemplate(template: string, data: unknown): string {
  return template.replace(SLOT, (_all, path: string) => lookup(data, path)).replace(/\s+/g, " ").trim();
}

/** What a client without a renderer for this block shows, as text. */
export function genericLine(block: Pick<Block, "type" | "v" | "traceId">): string {
  return `${block.type} block (v${block.v}), trace ${block.traceId}`;
}

export function fallbackText(block: Block, defs: ReadonlyMap<string, BlockDef>): string {
  const def = defs.get(`${block.type}@${block.v}`);
  if (!def) return genericLine(block);
  return fillTemplate(def.fallback, block.data) || block.type;
}
