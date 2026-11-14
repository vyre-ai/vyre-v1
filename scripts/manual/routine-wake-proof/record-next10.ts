// Run in the rc.26 tree: node test/b-clock-next10.ts <datadir> <out.json>. The next ten fire instants of every routine, goal check-in and automation schedule, with the OLD functions, from the folder's own stored state.
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { nextRun } from "../modules/agents/projections.ts";
import { nextCheckin } from "../modules/goals/projections.ts";
import { nextOccurrences } from "../modules/automations/schedule/cron.ts";

const [dir, out] = [process.argv[2]!, process.argv[3]!];
const db = new DatabaseSync(`${dir}/modules.db`, { readOnly: true });
const at = Number(process.argv[4] ?? Date.now());
const chain = (f: (after: number) => number | null | undefined): number[] => {
  const r: number[] = [];
  for (let t = at; r.length < 10; ) {
    const n = f(t);
    if (n === null || n === undefined) break;
    r.push(n);
    t = n;
  }
  return r;
};
const routines = (
  db.prepare("SELECT id, title, cron, enabled, nextRunAt FROM agents_routine ORDER BY title").all() as any[]
).map((r) => ({
  id: r.id,
  title: r.title,
  cron: r.cron,
  enabled: r.enabled,
  storedNext: r.nextRunAt,
  next10: r.cron ? chain((x) => nextRun(r.cron, x)) : [],
}));
const goals = (
  db.prepare("SELECT id, title, rhythm, zone, quiet, next_checkin_at FROM goals_goal ORDER BY title").all() as any[]
).map((g) => {
  const goal = { rhythm: JSON.parse(g.rhythm), zone: g.zone, quiet: g.quiet ? JSON.parse(g.quiet) : null };
  return { id: g.id, title: g.title, storedNext: g.next_checkin_at, next10: chain((x) => nextCheckin(goal, x)) };
});
const automations: unknown[] = [];
try {
  for (const d of db.prepare("SELECT id, name, definition FROM automations_defs").all() as any[]) {
    for (const t of JSON.parse(d.definition).triggers ?? [])
      if (t.key === "schedule") {
        const o = nextOccurrences(t.config.cron, t.config.timezone, at, 10);
        automations.push({ id: d.id, name: d.name, next10: "times" in o ? o.times : o });
      }
  }
} catch (e) {
  automations.push({ error: String(e) });
}
fs.writeFileSync(out, JSON.stringify({ at, routines, goals, automations }, null, 1));
console.log("recorded", out, routines.length, goals.length, automations.length);
