// MANUAL PROOF, not a gate (P1 step 4, lead's ruling 14 Nov 2026). Run it before a release that moves routines onto the Wake table, against a COPY of a real data folder made by the previous build.
// Usage, on a test box (never the Mac, never a real Space's own folder):
//   1. rc.26 or rc.27 tree:  node test/b-clock-seed.ts <zone> <outdir>        (seed.ts here; makes a folder through the product's own calls)   OR copy a real rc.27 data folder
//   2. same tree:            node test/b-clock-next10.ts <datadir> <next10.json>  (record-next10.ts here; the OLD next ten times of every routine)
//   3. this tree:            node test/zz-b-clock-proof.ts <datadir> <next10.json>   (copy this file to test/; it copies the folder, runs the new build on it)
// Expected output (three folders, UTC, Asia/Karachi, America/New_York; the same lines for each):
//   backfill: 5 wakes for 5 enabled cron routines (rows in agents_routine: 7)  and every routine "stored <time> wake <same time> EQUAL", watchers or paused with a wake: 0
//   every routine: "fired at <stored time>; next <t> recorded-old <t> EQUAL"
//   fires made: 11, most attempts on any fire: 1
//   Run keys routine:<id>:<due ms>: 11; fires: 11; the same set: YES; any key twice: no
//   each routine: "runs started by the schedule: <n>; first key is its stored time: YES"
//   after a restart: {...} UNCHANGED
//   fires: [{"state":"failed","n":11}]   (the scripted model has no account, so each Run fails and the sweep closes its fire)
// What a fire for a time an older build's tick had already taken looks like: it ends "skipped" with "The routine and its schedule do not agree on the time". That is right (one Run for the time, by its key) and not a lost run.
// New build on a data folder made by rc.26: the backfill, one Run per routine at its stored time (both the old tick and the wake tick in the same minute), the mirror, and a restart.
// node test/zz-b-clock-proof.ts <folder> <next10.json>
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { boot, call, clock } from "../../../test/memory-live-kit.ts";

const [src, rec] = [process.argv[2]!, JSON.parse(fs.readFileSync(process.argv[3]!, "utf8"))];
const dir = `${process.env["TMPDIR"] ?? "/tmp"}/proof-${Date.now()}`;
fs.cpSync(src, dir, { recursive: true });
clock.t = rec.at;
const out: string[] = [];
const say = (s: string): void => void (console.log(s), out.push(s));
const dbr = (): DatabaseSync => new DatabaseSync(`${dir}/modules.db`, { readOnly: true });
const routines = rec.routines.filter((r: any) => r.enabled === 1 && r.cron);
const stored = new Map<string, number>(routines.map((r: any) => [r.id, r.storedNext]));
const runsOf = async (d: any): Promise<Record<string, number>> => {
  const list = ((await call(d, "runs.list", { scope: "mine", kinds: ["routine"], limit: 500 })).data.runs ??
    []) as Array<{ name?: string; id: string }>;
  const o: Record<string, number> = {};
  for (const r of list) o[r.name ?? "?"] = (o[r.name ?? "?"] ?? 0) + 1;
  return o;
};
let d = await boot(dir);
try {
  await d.hooks!.runPeriodic("agents.routines_wake_sync");
  const wakes = dbr()
    .prepare("SELECT owner_id, next_at, active, cron, tz, kind FROM scheduler_api_schedules WHERE canceled_at IS NULL")
    .all() as any[];
  say(
    `backfill: ${wakes.length} wakes for ${routines.length} enabled cron routines (rows in agents_routine: ${rec.routines.length})`,
  );
  for (const r of routines) {
    const w = wakes.find((x) => x.owner_id === r.id);
    say(
      `  ${r.title.padEnd(18)} stored ${new Date(r.storedNext).toISOString()} wake ${w ? new Date(w.next_at).toISOString() : "NONE"} ${w && w.next_at === r.storedNext && w.tz === "UTC" ? "EQUAL" : "DIFFERENT"}`,
    );
  }
  say(
    `  watchers or paused with a wake: ${wakes.filter((w) => !routines.some((r: any) => r.id === w.owner_id)).length}`,
  );
  await d.hooks!.runPeriodic("agents.routines_wake_sync");
  say(
    `  second reconcile pass changed: ${dbr().prepare("SELECT COUNT(*) n FROM scheduler_api_schedules").get()!["n"]} wakes (same count)`,
  );
  // each routine at its stored time, in order: the wake tick runs (twice, to show a second pass starts nothing)
  for (const r of [...routines].sort((a: any, b: any) => a.storedNext - b.storedNext)) {
    clock.t = r.storedNext + 30_000;
    await d.hooks!.runPeriodic("scheduler.wakes");
    await d.hooks!.runPeriodic("scheduler.wakes");
    const row = dbr().prepare("SELECT nextRunAt, lastRunAt FROM agents_routine WHERE id = ?").get(r.id) as any;
    const idx = r.next10.findIndex((t: number) => t > clock.t);
    say(
      `  ${r.title.padEnd(18)} fired at ${new Date(r.storedNext).toISOString()}; next ${new Date(row.nextRunAt).toISOString()} recorded-old ${new Date(r.next10[idx]).toISOString()} ${row.nextRunAt === r.next10[idx] ? "EQUAL" : "DIFFERENT"}`,
    );
  }
  const runs = await runsOf(d);
  const keysOf = (): string[] =>
    (
      dbr().prepare("SELECT idem_key FROM runs_idem WHERE idem_key LIKE 'routine:%' ORDER BY idem_key").all() as any[]
    ).map((x) => x.idem_key);
  const fireKeys = (): string[] =>
    (
      dbr()
        .prepare(
          "SELECT s.owner_id AS o, f.due_key AS k FROM scheduler_api_fires f JOIN scheduler_api_schedules s ON s.id = f.schedule_id ORDER BY 1, 2",
        )
        .all() as any[]
    )
      .map((x) => `routine:${x.o}:${x.k}`)
      .sort();
  const attempts = dbr().prepare("SELECT MAX(attempt) m, COUNT(*) n FROM scheduler_api_fires").get() as any;
  say(`fires made: ${attempts.n}, most attempts on any fire: ${attempts.m}`);
  say(
    `Run keys routine:<id>:<due ms>: ${keysOf().length}; fires: ${fireKeys().length}; the same set: ${JSON.stringify(keysOf()) === JSON.stringify(fireKeys()) ? "YES" : "NO"}; any key twice: ${new Set(keysOf()).size !== keysOf().length ? "YES" : "no"}`,
  );
  for (const r of routines) {
    const ks = keysOf().filter((k) => k.startsWith(`routine:${r.id}:`));
    say(
      `  ${r.title.padEnd(18)} runs started by the schedule: ${ks.length}; first key is its stored time: ${ks[0] === `routine:${r.id}:${r.storedNext}` ? "YES" : "NO " + ks[0]}`,
    );
  }
  // a restart: stop, start on the same folder a few seconds later, tick both: still one each
  await d.stop();
  clock.t += 10_000;
  d = await boot(dir);
  await d.hooks!.runPeriodic("agents.routines_wake_sync");
  await d.hooks!.runPeriodic("scheduler.wakes");
  const again = await runsOf(d);
  say(
    `after a restart: ${JSON.stringify(again)} ${JSON.stringify(again) === JSON.stringify(runs) ? "UNCHANGED" : "CHANGED"}`,
  );
  const fires = dbr().prepare("SELECT state, COUNT(*) n FROM scheduler_api_fires GROUP BY state").all();
  say(`fires: ${JSON.stringify(fires)}`);
} finally {
  await d.stop();
}
fs.writeFileSync(`${process.env["TMPDIR"] ?? "/tmp"}/proof2-out-${src.split("/").pop()}.txt`, out.join("\n"));
