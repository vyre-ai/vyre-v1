// What the site page says, as plain functions: a deploy's name and its quiet line, how long a step took, which lines of the log belong to which step, and the one thing that needs a person now.
// Nothing here reads or draws; the page (SitePage.tsx) and the deploy pane (DeployPane.tsx) call these, and model.test.ts pins the words.
import type { CapMap } from "../../../../../../../generated/types.ts";

export type Site = CapMap["sites.get"]["out"]["site"];
export type Dep = CapMap["sites.deployments"]["out"]["deployments"][number];
export type Step = NonNullable<Dep["steps"]>[number];
export type StepKey = Step["key"];
export type LogSteps = NonNullable<CapMap["sites.logs"]["out"]["steps"]>;
export type Tone = "ok" | "quiet" | "warn" | "bad" | "mine";

export const STEP_TITLE: Readonly<Record<StepKey, string>> = {
  fetch: "Fetch",
  build: "Build",
  start: "Start",
  check: "Check",
};

/** How long something took, the way a person says it: 47 s, 1 min 12 s. */
export function took(ms: number): string {
  if (ms < 1000) return "under 1 s";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60),
    r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}

/** A clock that runs: 0:23. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const isRunning = (d: Pick<Dep, "state">): boolean => d.state === "building" || d.state === "queued";
export const runningStep = (d: Pick<Dep, "steps">): Step | undefined => d.steps?.find((s) => s.state === "running");

/** A deploy in a word, and the tone its dot takes. A canceled deploy is not a failure. */
export function depState(d: Pick<Dep, "state" | "current">): { word: string; tone: Tone } {
  if (d.current) return { word: "Live", tone: "ok" };
  if (d.state === "building") return { word: "Deploying", tone: "mine" };
  if (d.state === "queued") return { word: "Waiting", tone: "mine" };
  if (d.state === "failed") return { word: "Failed", tone: "bad" };
  if (d.state === "stopped") return { word: "Canceled", tone: "quiet" };
  return { word: "Earlier", tone: "quiet" };
}

/** What a deploy is called: its commit's first line, else its commit, else what was deployed. */
export function depTitle(d: Pick<Dep, "message" | "commit" | "branch">): string {
  if (d.message) return d.message;
  if (d.commit) return `Commit ${d.commit.slice(0, 7)}`;
  return d.branch ? `Deploy of ${d.branch}` : "Deploy";
}

/** The quiet line under a deploy: branch, commit, who; then the step it is on, or when it ended and how long it took; a failure ends with why. */
export function depNote(d: Dep, who: string | null, when: string, now: number, why = true): string {
  const parts: string[] = [];
  if (d.branch) parts.push(d.branch);
  if (d.commit && d.message) parts.push(d.commit.slice(0, 7));
  if (who) parts.push(who);
  if (isRunning(d)) {
    const st = runningStep(d);
    parts.push(st ? `${STEP_TITLE[st.key]} ${clock(now - (st.startedAt ?? d.at))}` : "Waiting for its turn");
    return parts.join(" · ");
  }
  parts.push(when);
  if (d.state === "ready" && d.finishedAt !== undefined) parts.push(took(d.finishedAt - d.at));
  if (why && d.state === "failed" && d.problem) parts.push(d.problem);
  return parts.join(" · ");
}

/** Each step with its own lines of the log, from where each begins. A log from before steps were kept is one block under no step. */
export function stepLines(
  lines: readonly string[],
  steps: LogSteps | undefined,
): { key: StepKey; lines: readonly string[] }[] | null {
  if (!steps || steps.length === 0) return null;
  const starts = steps.map((s) => (s.from === undefined ? null : Math.max(0, Math.min(lines.length, s.from))));
  return steps.map((s, i) => {
    const from = starts[i];
    if (from === null || from === undefined) return { key: s.key, lines: [] };
    let to = lines.length;
    for (let j = i + 1; j < starts.length; j++) {
      const next = starts[j];
      if (next !== null && next !== undefined) {
        to = Math.max(from, next);
        break;
      }
    }
    return { key: s.key, lines: lines.slice(from, to) };
  });
}

/** The lines that hold what was typed, any case. Nothing typed keeps them all. */
export function findLines(lines: readonly string[], typed: string): readonly string[] {
  const q = typed.trim().toLowerCase();
  return q === "" ? lines : lines.filter((l) => l.toLowerCase().includes(q));
}

export const FIX_TITLE: Readonly<Record<string, string>> = {
  set_env: "Add the variable",
  add_postgres: "Add Postgres and deploy",
  add_redis: "Add Redis and deploy",
  retry: "Deploy again",
  set_start: "Ask an agent to fix it",
  set_port: "Ask an agent to fix it",
  open_logs: "Read the log",
  connect_repo: "Change the source",
  free_space: "Open Settings",
  more_memory: "Double the memory and deploy",
};

/** Where a site's code comes from, in a line. */
export function sourceLine(src: NonNullable<Site["source"]>): string {
  if (src.repo)
    return `${src.repo.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "")}${src.branch ? ` (${src.branch})` : ""}${src.root ? `, ${src.root}` : ""}`;
  if (src.fileId) return "An upload in Files";
  if (src.folderId) return "A folder in Files";
  return src.path ?? "A folder";
}

/** The site in a word for the line under its name. A failed deploy does not take a serving site down, so it still says Live. */
export function siteWord(x: Pick<Site, "state" | "live" | "blocked" | "lastDeploy">): { word: string; tone: Tone } {
  if (x.blocked) return { word: "Taken down", tone: "warn" };
  if (x.state === "building") return { word: "Deploying", tone: "mine" };
  if (x.live) return { word: "Live", tone: "ok" };
  if (x.lastDeploy?.current) return { word: "Not published", tone: "quiet" };
  if (x.lastDeploy?.state === "failed") return { word: "Not live yet", tone: "bad" };
  return { word: "Stopped", tone: "quiet" };
}

/** The one thing on the page that needs a person: a deploy that is running, or the last one that failed. A canceled deploy asks for nothing. */
export function attention(
  x: Pick<Site, "lastDeploy" | "live">,
  now: number,
): { kind: "running" | "failed"; tone: Tone; label: string; note: string } | null {
  const d = x.lastDeploy;
  if (!d) return null;
  if (isRunning(d)) {
    const st = runningStep(d);
    return {
      kind: "running",
      tone: "mine",
      label: "Deploying",
      note: st
        ? `${STEP_TITLE[st.key]} · ${clock(now - (st.startedAt ?? d.at))}`
        : d.state === "queued"
          ? "Waiting for its turn"
          : "Starting",
    };
  }
  if (d.state === "failed")
    return {
      kind: "failed",
      tone: "bad",
      label: x.live ? "The last deploy failed. The one before it is still live" : "The deploy failed",
      note: d.problem ?? "The log says why.",
    };
  return null;
}

/** The name the env var a failure names, for the Add field: "It stopped because STRIPE_KEY is not set." */
export function missingName(problem: string | undefined): string | null {
  return /because (\w+) is not set/.exec(problem ?? "")?.[1] ?? null;
}
