// Shared by the daemon tests that stop a real vyred with SIGTERM (daemon.damaged-*.test.ts): the stop is measured against the documented bound and never cut short, and a stop
// that runs past 20 s leaves evidence for the failure message: a Node diagnostic report taken then (SIGUSR2, --report-on-signal: the JS stack and the active libuv handles, which
// show what the stop waits in) and the daemon's own log rows from the SIGTERM on (logs.db: daemon.stopping and whatever the closers said). Nothing here kills the daemon.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ChildProcess } from "node:child_process";

/** A whole stop's bounded waits add up to about 30 s (host/src/daemon/daemon.ts, HOOKS_STOP_MS): a stop after SIGTERM must end within that. */
export const STOP_BOUND_MS = 30_000;

/** Node flags that let watchStop ask the daemon for a report while it stops. */
export const reportArgs = (reportDir: string): string[] => [
  "--report-on-signal",
  "--report-signal=SIGUSR2",
  `--report-directory=${reportDir}`,
];

export type StopWatch = { term: () => void; stopMs: () => number | null; evidence: () => string };

export function watchStop(child: ChildProcess, dataDir: string, reportDir: string): StopWatch {
  let termAt = 0,
    exitAt = 0;
  let timer: NodeJS.Timeout | undefined;
  child.once("exit", () => {
    exitAt = Date.now();
    if (timer) clearTimeout(timer);
  });
  return {
    term: () => {
      if (termAt) return;
      termAt = Date.now();
      child.kill("SIGTERM");
      timer = setTimeout(() => {
        if (!exitAt) child.kill("SIGUSR2");
      }, 20_000);
      timer.unref();
    },
    stopMs: () => (termAt && exitAt ? exitAt - termAt : null),
    evidence: () => {
      const out: string[] = [];
      try {
        const d = new DatabaseSync(path.join(dataDir, "logs.db"), { readOnly: true });
        const rows = d
          .prepare("SELECT at, level, place, msg, attrs FROM logs WHERE at >= ? ORDER BY at")
          .all(termAt - 500) as Array<Record<string, unknown>>;
        d.close();
        out.push(
          `daemon log from the SIGTERM on (${rows.length} rows):`,
          ...rows.map(
            (r) =>
              `  +${Number(r.at) - termAt} ms ${String(r.place)} ${String(r.msg)} ${String(r.attrs ?? "").slice(0, 200)}`,
          ),
        );
      } catch (e) {
        out.push(`no daemon log: ${e instanceof Error ? e.message : String(e)}`);
      }
      try {
        for (const f of fs.readdirSync(reportDir)) {
          const j = JSON.parse(fs.readFileSync(path.join(reportDir, f), "utf8")) as {
            javascriptStack?: { stack?: string[] };
            libuv?: Array<Record<string, unknown>>;
          };
          out.push(
            `report ${f}:`,
            `  stack: ${(j.javascriptStack?.stack ?? []).slice(0, 15).join(" | ")}`,
            ...(j.libuv ?? [])
              .filter((h) => h["is_active"])
              .map((h) => `  handle ${String(h["type"])} ${JSON.stringify(h).slice(0, 200)}`),
          );
        }
      } catch {
        out.push("no report");
      }
      return out.join("\n");
    },
  };
}
