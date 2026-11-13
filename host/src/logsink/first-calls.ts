// The first-call read (13 Nov 2026, owner: "for everything its first attempts are failing always"): from the rows the invoke pipeline already writes, per tool, how many first calls were refused, which inputs
// and rules were wrong, which codes the other refusals had, and how many retries worked. Reads names and rules only: the rows never held a value (host/src/invoke.ts rejectedFields).
//   node scripts/first-call-report.ts <logs.db> [days]
import type { DatabaseSync } from "node:sqlite";

export interface FirstCallRow {
  tool: string;
  /** First calls to this tool in a turn that were refused. */
  firstRefused: number;
  /** Refusals of a later call of the same tool in the same turn. */
  laterRefused: number;
  /** Calls that worked straight after a refusal of the same tool for its input. */
  retriedOk: number;
  /** Which inputs were wrong and the rule each broke, most often first. */
  byInput: Array<{ path: string; rule: string; n: number }>;
  /** Every refusal by its code. */
  byCode: Record<string, number>;
}

/** The refused calls and the retries that worked since `sinceMs`, per tool, the tool with most refusals first. */
export function firstCallReport(db: DatabaseSync, sinceMs: number): FirstCallRow[] {
  const rows = db
    .prepare(
      "SELECT msg, result, attrs FROM logs WHERE at >= ? AND msg IN ('invoke', 'invoke.retry_ok') AND attrs LIKE '%\"tool\"%'",
    )
    .all(sinceMs) as Array<{ msg: string; result: string | null; attrs: string | null }>;
  const by = new Map<string, FirstCallRow & { inputs: Map<string, number> }>();
  for (const r of rows) {
    let a: { tool?: unknown; first?: unknown; fields?: unknown };
    try {
      a = JSON.parse(r.attrs ?? "{}") as typeof a;
    } catch {
      continue;
    }
    if (typeof a.tool !== "string") continue;
    let x = by.get(a.tool);
    if (!x) {
      x = { tool: a.tool, firstRefused: 0, laterRefused: 0, retriedOk: 0, byInput: [], byCode: {}, inputs: new Map() };
      by.set(a.tool, x);
    }
    if (r.msg === "invoke.retry_ok") {
      x.retriedOk++;
      continue;
    }
    if (a.first === true) x.firstRefused++;
    else x.laterRefused++;
    const code = r.result ?? "error";
    x.byCode[code] = (x.byCode[code] ?? 0) + 1;
    if (Array.isArray(a.fields))
      for (const f of a.fields as Array<{ path?: unknown; rule?: unknown }>)
        if (typeof f.path === "string" && typeof f.rule === "string")
          x.inputs.set(`${f.path}\u0000${f.rule}`, (x.inputs.get(`${f.path}\u0000${f.rule}`) ?? 0) + 1);
  }
  return [...by.values()]
    .map(({ inputs, ...x }) => ({
      ...x,
      byInput: [...inputs.entries()]
        .map(([k, n]) => ({ path: k.split("\u0000")[0] as string, rule: k.split("\u0000")[1] as string, n }))
        .sort((p, q) => q.n - p.n || p.path.localeCompare(q.path)),
    }))
    .sort(
      (p, q) => q.firstRefused + q.laterRefused - (p.firstRefused + p.laterRefused) || p.tool.localeCompare(q.tool),
    );
}
