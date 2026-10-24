// Per flow, the stub modules still blocking it (ARCH 12.4). The lead reads this at hours 6, 9 and 11.
//   node scripts/golden-ready.ts [--deadline 6|9|11]   exits 1 when the deadline's flows still have blockers
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blockers, flowId, loadFlows, loadRegistryModules } from "../golden/harness/index.ts";
import type { Flow, ModuleStatus } from "../golden/harness/index.ts";

/** Hour 6: flows 1, 4, 14 have no stub. Hour 9: all flows except those needing Forms or Campaigns. Hour 11: zero pending. */
export function dueAt(hour: number, flows: Flow[]): Flow[] {
  if (hour === 6) return flows.filter((f) => [1, 4, 14].includes(f.n));
  if (hour === 9) return flows.filter((f) => !f.needs.some((m) => m === "forms" || m === "campaigns"));
  if (hour === 11) return flows;
  throw new Error(`deadline hour must be 6, 9 or 11, got ${hour}`);
}

export function readyReport(flows: Flow[], modules: ModuleStatus[], hour?: number): { lines: string[]; late: string[] } {
  const due = new Set((hour ? dueAt(hour, flows) : []).map((f) => f.n));
  const lines: string[] = [];
  const late: string[] = [];
  for (const f of flows) {
    const b = blockers(f, modules);
    lines.push(b.length ? `${flowId(f)}  PENDING (${b.length}): ${b.join(", ")}` : `${flowId(f)}  READY`);
    if (b.length && due.has(f.n)) late.push(flowId(f));
  }
  const pending = lines.filter((l) => l.includes("PENDING")).length;
  lines.push(`${flows.length - pending} ready, ${pending} pending${hour ? `; hour ${hour} deadline: ${late.length ? `late ${late.join(", ")}` : "met"}` : ""}`);
  return { lines, late };
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const i = process.argv.indexOf("--deadline");
  const hour = i >= 0 ? Number(process.argv[i + 1]) : undefined;
  const { lines, late } = readyReport(await loadFlows(), loadRegistryModules(), hour);
  console.log(lines.join("\n"));
  process.exit(late.length ? 1 : 0);
}
