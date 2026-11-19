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

// ---- variables: a pasted .env, which names are secrets, and the list as env_set takes it

export type EnvRow = CapMap["sites.env_list"]["out"]["entries"][number];
export type EnvScope = EnvRow["scope"];
export type EnvEntry = { name: string; vaultHandle?: string; value?: string; scope?: EnvScope };

export const SCOPE_TITLE: Readonly<Record<EnvScope, string>> = {
  all: "Everywhere",
  production: "Production",
  previews: "Previews",
};

/** A row of the list as env_set takes it back, so changing one name keeps every other as it was. */
export function entryOf(r: EnvRow): EnvEntry {
  return {
    name: r.name,
    scope: r.scope,
    ...(r.kind === "plain" ? { value: r.value ?? "" } : { vaultHandle: r.vaultName }),
  };
}

/** The names that carry a secret by what they say: keys, tokens, passwords, and an address with a login in it. Everything else in a pasted .env is plain. */
const SECRET_NAME = /(^|_)(KEY|SECRET|TOKEN|PASSWORD|PASSWD|PASS|PWD|PRIVATE|CREDENTIALS?|AUTH|SALT|DSN)(_|$)/i;
const URL_WITH_LOGIN = /^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i;
export const isSecretVar = (name: string, value: string): boolean =>
  SECRET_NAME.test(name) || URL_WITH_LOGIN.test(value);

/** Parse the text of a .env: NAME=value lines, `export NAME=value`, quoted values (a double quote reads \n), a trailing # comment on an unquoted value, blank and # lines skipped. The last of a repeated name wins. Names that cannot be env vars come back in `skipped`. */
export function parseEnv(text: string): {
  vars: { name: string; value: string; secret: boolean }[];
  skipped: string[];
} {
  const found = new Map<string, string>();
  const skipped: string[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([^=\s]+)\s*=\s*(.*)$/.exec(line);
    if (!m) {
      skipped.push(line.slice(0, 40));
      continue;
    }
    const name = m[1] as string;
    let v = (m[2] as string).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)) {
      skipped.push(name.slice(0, 40));
      continue;
    }
    if (v.startsWith('"') && v.lastIndexOf('"') > 0)
      v = v.slice(1, v.lastIndexOf('"')).replace(/\\n/g, "\n").replace(/\\"/g, '"');
    else if (v.startsWith("'") && v.lastIndexOf("'") > 0) v = v.slice(1, v.lastIndexOf("'"));
    else v = v.replace(/\s+#.*$/, "");
    found.set(name, v);
  }
  return { vars: [...found].map(([name, value]) => ({ name, value, secret: isSecretVar(name, value) })), skipped };
}

/** What a paste does to the list: each name is added or replaces the one with that name. Names Vyre sets itself (PORT and the like) are left out and said so. */
export function mergeEnv(
  have: readonly EnvEntry[],
  add: readonly EnvEntry[],
  reserved: ReadonlySet<string> = new Set(["PORT", "HOST", "HOSTNAME", "PATH", "HOME"]),
): { entries: EnvEntry[]; left: string[] } {
  const left = add.filter((e) => reserved.has(e.name)).map((e) => e.name);
  const keep = add.filter((e) => !reserved.has(e.name));
  const names = new Set(keep.map((e) => e.name));
  return { entries: [...have.filter((e) => !names.has(e.name)), ...keep], left };
}

// ---- the New site sheet: what Vyre read from the source, before anything runs

export type Plan = CapMap["sites.plan"]["out"];

/** A repo as the sheet's field takes it: owner/name, with or without the address, a trailing .git or slash. Null while it is not one yet. */
export function repoOf(typed: string): string | null {
  const r = typed
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  return /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/.test(r) ? r : null;
}

/** What was found, in one or two lines: what it is and how it builds (the plan's own note), then what it needs. */
export function foundLines(p: Pick<Plan, "note" | "needs" | "env">): string[] {
  const out = [p.note];
  const needs = [
    ...p.needs.map((n) => (n === "postgres" ? "a Postgres database" : "Redis")),
    ...(p.env.length
      ? [
          `${p.env.length} variable${p.env.length === 1 ? "" : "s"} (${p.env.slice(0, 4).join(", ")}${p.env.length > 4 ? ", ..." : ""})`,
        ]
      : []),
  ];
  if (needs.length) out.push(`It looks for ${needs.join(" and ")}. You set them after it is created.`);
  return out;
}

/** The branches typed in the Settings field: split on commas and spaces, empty ones dropped, each once. */
export function parseFollow(typed: string): string[] {
  return [...new Set(typed.split(/[\s,]+/).filter((s) => s !== ""))];
}
