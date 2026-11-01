// What the lead waits on that is not a teammate (DESIGN-crew.md): the checks of a pull request. The host looks, not the model: this sweep reads the checks of every pending wait through the GitHub capability as
// the person who set it, keeps the progress current for the Crew tab, and when the checks end it posts one message in the lead's chat, as that person and naming the lead, which wakes the lead the ordinary way.
import type { Db } from "./projections.ts";
import { ensure } from "./projections.ts";
import type { EngineHostSeam } from "../../host/src/seams/engine.ts";

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);

interface Checks { state: "none" | "pending" | "passing" | "failing"; runs: Array<{ name: string; status: string; conclusion?: string }> }

/** The words the lead wakes on. */
export function waitWords(label: string, c: Checks): string {
  const failed = c.runs.filter((r) => r.conclusion !== undefined && r.conclusion !== "success" && r.conclusion !== "skipped" && r.conclusion !== "neutral").map((r) => r.name);
  if (c.state === "passing") return `The checks of ${label} passed (${c.runs.length}).`;
  if (c.state === "failing") return `The checks of ${label} failed${failed.length ? `: ${failed.slice(0, 5).join(", ")}` : ""}.`;
  return `The checks of ${label} ended with nothing to report.`;
}

export async function sweepWaits(o: { db: Db; host: Pick<EngineHostSeam, "call" | "log">; now: () => number }): Promise<string[]> {
  ensure(o.db);
  const rows = o.db.all("SELECT * FROM engine_crew_wait WHERE state = 'pending' ORDER BY started_at LIMIT 50") as Row[];
  const ended: string[] = [];
  for (const r of rows) {
    const id = str(r["wait_id"]);
    let checks: Checks;
    try { checks = (await o.host.call("github.pull_request.checks", { repo: str(r["repo"]), number: num(r["number"]) }, str(r["asker"]))) as Checks; } catch (e) { o.host.log?.("the checks a crew is waiting on could not be read", { waitId: id, error: e instanceof Error ? e.message : String(e) }); continue; }
    const total = checks.runs.length;
    const done = checks.runs.filter((x) => x.status === "completed").length;
    if (checks.state === "pending") { o.db.run("UPDATE engine_crew_wait SET done = ?, total = ? WHERE wait_id = ?", done, total, id); continue; }
    o.db.run("UPDATE engine_crew_wait SET state = ?, done = ?, total = ?, ended_at = ?, outcome = ? WHERE wait_id = ?", checks.state, done, total, o.now(), checks.state, id);
    const words = waitWords(str(r["label"]), checks);
    try {
      await o.host.call("chat.post", {
        threadId: str(r["lead_thread_id"]), body: words, mentions: [{ kind: "agent", id: str(r["agent_id"]) }],
        blocks: [{ type: "crew_wait", v: 1, data: { waitId: id, label: str(r["label"]), outcome: checks.state, done, total } }], idempotencyKey: `crew-wait-${id}`,
      }, str(r["asker"]));
      ended.push(id);
    } catch (e) { o.host.log?.("the lead could not be woken for a finished wait", { waitId: id, error: e instanceof Error ? e.message : String(e) }); }
  }
  return ended;
}
