// What an Assistant proposed for an Automation, kept apart until a person accepts it (AUTOMATIONS-BUILD-RC29 phase 2; design AUTOMATIONS-2026-11-13 2.7).
// A proposal is never the definition and never the person's own draft: reading an Automation shows it beside them, and only a person's Accept writes it.
import type { Db, Definition } from "./projections.ts";

type Raw = Record<string, unknown>;

export interface ProposalRow {
  definition: Definition;
  /** One line a person reads on the bar: what the steps do, in plain words. */
  summary: string;
  /** The agent (or person) that proposed it. */
  by: string;
  /** The person it was made for: whoever the agent was working for. */
  forWho: string;
  /** The version and the draft rev the proposal was written against; a change to either makes it stale. */
  baseVersion: number;
  baseRev: number;
  /** True when proposing made the Automation itself (an empty, off one), so discarding the proposal may take that shell away. */
  madeShell: boolean;
  at: number;
}

const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

export function findProposal(db: Db, automationId: string): ProposalRow | undefined {
  const r = (db.all("SELECT * FROM automations_proposals WHERE automation_id = ?", automationId) as Raw[])[0];
  if (!r) return undefined;
  let definition: Definition | undefined;
  try {
    definition = JSON.parse(r.definition as string) as Definition;
  } catch {
    return undefined;
  }
  if (!definition) return undefined;
  return {
    definition,
    summary: typeof r.summary === "string" ? r.summary : "",
    by: r.by_who as string,
    forWho: r.for_who as string,
    baseVersion: num(r.base_version) ?? 1,
    baseRev: num(r.base_rev) ?? 0,
    madeShell: num(r.made_shell) === 1,
    at: num(r.at) ?? 0,
  };
}

export function writeProposal(db: Db, automationId: string, p: ProposalRow): void {
  db.run(
    "INSERT OR REPLACE INTO automations_proposals (automation_id, definition, summary, by_who, for_who, base_version, base_rev, made_shell, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    automationId,
    JSON.stringify(p.definition),
    p.summary,
    p.by,
    p.forWho,
    p.baseVersion,
    p.baseRev,
    p.madeShell ? 1 : 0,
    p.at,
  );
}

export function dropProposal(db: Db, automationId: string): void {
  db.run("DELETE FROM automations_proposals WHERE automation_id = ?", automationId);
}

/** What a read of an Automation carries about its proposal. */
export function proposalOut(p: ProposalRow): Record<string, unknown> {
  return {
    definition: p.definition,
    summary: p.summary,
    by: p.by,
    for: p.forWho,
    baseVersion: p.baseVersion,
    at: p.at,
    steps: Array.isArray(p.definition.nodes) ? p.definition.nodes.length : 0,
  };
}
