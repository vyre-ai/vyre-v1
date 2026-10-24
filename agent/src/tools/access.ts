// toolsFor (ARCH 6.7, 4.13): what a turn may be offered. Filters, in order: engineer toolset, the agent's allow and deny lists, plan mode, and in an Ask pane the asker's level on the scope.
// This list is what the model sees; the invoke pipeline still intersects agent and asker access on every call, so a tool being listed never grants anything.
import { LEVEL_RANK } from "./types.ts";
import type { Catalog, Level, Refusal, ThreadFacts, ToolCtx, ToolDef, ToolSet } from "./types.ts";

/** The one write an Ask pane offers a view-only person: it stores a drafted change for the editors and writes nothing else (ARCH 4.13). */
export const ASK_VIEW_EXTRAS: ReadonlySet<string> = new Set(["access.propose_change"]);

export interface AccessDeps {
  catalog: Catalog;
  /** The frozen default listed set (about 60 tool names, docs/frozen/agent-tools.md). Every other tool is found with tool_search (ruling 8). */
  defaults: ReadonlySet<string>;
  /** authorize(asker, scope).scope.level, or null when the asker has no access to the scope. */
  levelFor(asker: string, scope: { type: string; id: string }): Level | null;
  /** Does the asker hold engineer.mcp? The engineer toolset is never offered otherwise. */
  canEngineer?(asker: string): boolean;
}

const listsTool = (list: readonly string[] | undefined, t: ToolDef): boolean => list !== undefined && (list.includes(t.name) || list.includes(t.toolset));

export function askLevel(deps: AccessDeps, asker: string, thread: ThreadFacts): Level | null {
  if (thread.kind !== "ask") return "manage";
  return thread.scope ? deps.levelFor(asker, thread.scope) : "view";   // an Ask pane with no scope gets the narrowest set
}

/** Level rule for an Ask pane: view = read tools at view plus the propose-change extra; use and above = everything up to that level. */
export function allowedAtLevel(level: Level, t: ToolDef): boolean {
  if (LEVEL_RANK[t.level] > LEVEL_RANK[level]) return false;
  if (level === "view") return t.effects === "read" || ASK_VIEW_EXTRAS.has(t.cap);
  return true;
}

/** Null when the tool may be offered, else why not. */
export function refusalFor(deps: AccessDeps, ctx: ToolCtx, t: ToolDef, level: Level | null): Refusal | null {
  if (t.toolset === "engineer" && deps.canEngineer?.(ctx.asker) !== true) return "engineer";
  if (listsTool(ctx.rules?.deny, t)) return "agent_denied";
  if (ctx.rules?.allow !== undefined && ctx.rules.allow.length > 0 && !listsTool(ctx.rules.allow, t)) return "agent_denied";
  if (ctx.thread.planMode && (t.planMode === "blocked" || t.effects === "outward")) return "plan_mode";
  if (level === null) return "no_access";
  if (ctx.thread.kind === "ask" && !allowedAtLevel(level, t)) return "ask_level";
  return null;
}

export function toolsFor(deps: AccessDeps, ctx: ToolCtx): ToolSet {
  const level = askLevel(deps, ctx.asker, ctx.thread);
  const listed: ToolDef[] = [];
  const searchable: ToolDef[] = [];
  for (const t of deps.catalog.all) {
    if (refusalFor(deps, ctx, t, level) !== null) continue;
    (deps.defaults.has(t.name) ? listed : searchable).push(t);
  }
  return { level, listed, searchable };
}

/** tool_search: rank the deferred tools the asker may use by how many query words hit the name, toolset or summary. Names and schemas come back; calling them is then allowed. */
export function searchTools(searchable: readonly ToolDef[], query: string, limit = 8): ToolDef[] {
  const words = query.toLowerCase().split(/[^a-z0-9_]+/).filter((w) => w.length > 1);
  if (words.length === 0) return [];
  const scored: Array<{ t: ToolDef; s: number }> = [];
  for (const t of searchable) {
    const name = t.name.toLowerCase(), rest = `${t.toolset} ${t.summary}`.toLowerCase();
    let s = 0;
    for (const w of words) s += (name.includes(w) ? 3 : 0) + (rest.includes(w) ? 1 : 0);
    if (s > 0) scored.push({ t, s });
  }
  scored.sort((a, b) => b.s - a.s || a.t.name.localeCompare(b.t.name));
  return scored.slice(0, limit).map((x) => x.t);
}
