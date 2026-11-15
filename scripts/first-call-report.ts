// Per tool, how many of an agent's first calls were refused over the last days, for which inputs and rules, and how many retries worked. Reads a Space's logs.db (read only). Names and rules only.
//   node scripts/first-call-report.ts <path to logs.db> [days=4]
import { DatabaseSync } from "node:sqlite";
import { firstCallReport } from "../host/src/logsink/first-calls.ts";

const [path, daysArg] = process.argv.slice(2);
if (!path) {
  console.error("usage: node scripts/first-call-report.ts <logs.db> [days]");
  process.exit(2);
}
const days = Number(daysArg ?? 4);
const db = new DatabaseSync(path, { readOnly: true });
const rows = firstCallReport(db, Date.now() - days * 86_400_000);
console.log(`tool calls refused in the last ${days} days, by tool`);
for (const r of rows) {
  console.log(
    `\n${r.tool}: first calls refused ${r.firstRefused}, later calls refused ${r.laterRefused}, retries that worked ${r.retriedOk}`,
  );
  console.log(
    `  codes: ${Object.entries(r.byCode)
      .map(([k, n]) => `${k} ${n}`)
      .join(", ")}`,
  );
  for (const i of r.byInput.slice(0, 6)) console.log(`  input ${i.path}: ${i.rule} (${i.n})`);
}
