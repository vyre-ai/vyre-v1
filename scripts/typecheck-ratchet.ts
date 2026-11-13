// Typecheck ratchet for apps/app and ui: tsc over tsconfig.typecheck.json, the errors counted and compared with the checked-in count (scripts/typecheck-baseline.json). With
// `--project tsconfig.typecheck.server.json --baseline scripts/typecheck-baseline.server.json` the same ratchet over modules/, host/ and packages/contracts, which nothing typechecked before 12 Nov.
// More errors than the baseline fail; fewer pass and say so, and `--update` writes the lower count (it refuses to raise it). So new errors cannot land and the count only falls.
// Module-not-found errors (TS2307, TS7016) are not counted: they say what the machine has installed, not what the code says. Without react-native installed the check is skipped.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const UNCOUNTED = new Set(["TS2307", "TS7016"]);

/** The counted errors of tsc's output: one per `error TSnnnn` line, less the uncounted codes. */
export function countErrors(output: string): number {
  let n = 0;
  for (const line of output.split("\n")) {
    const m = /error (TS\d+):/.exec(line);
    if (m && !UNCOUNTED.has(m[1]!)) n++;
  }
  return n;
}

/** pass, or fail with why; `lower` says the baseline may be written lower. */
export function judge(count: number, baseline: number): { ok: boolean; lower: boolean; words: string } {
  if (count > baseline)
    return {
      ok: false,
      lower: false,
      words: `${count} typecheck errors, ${count - baseline} more than the ${baseline} the repo allows. Fix the new ones (tsc -p tsconfig.typecheck.json).`,
    };
  if (count < baseline)
    return {
      ok: true,
      lower: true,
      words: `${count} typecheck errors, ${baseline - count} fewer than the baseline ${baseline}: run with --update to lock the lower count in.`,
    };
  return { ok: true, lower: false, words: `${count} typecheck errors, as allowed.` };
}

/**
 * Did the compiler finish, so its count can be believed (fifth look V5)? A tsc that could not start, was killed (memory) or overflowed the buffer prints fewer error lines and would pass with a
 * low count. Not finished: a spawn error, a signal, or no error lines with a failing exit. A drop of more than a fifth below the baseline is believed only with --update (a person looks at it).
 * The baseline itself may not be above the one on the merge base: a raise must not slip in with other changes.
 */
export function trustworthy(
  r: { error?: unknown; signal?: string | null; status: number | null },
  count: number,
  baseline: number,
  o: { update: boolean; mergeBaseBaseline: number | null },
): string | null {
  if (r.error) return `tsc did not run (${r.error instanceof Error ? r.error.message : String(r.error)})`;
  if (r.signal) return `tsc was stopped by ${r.signal} before it finished`;
  if (count === 0 && r.status !== 0) return `tsc exited ${r.status} with no error lines: it did not finish`;
  if (!o.update && baseline > 0 && count < baseline * 0.8)
    return `${count} errors is a sudden drop from ${baseline}: check that tsc finished; if the drop is real, run with --update`;
  if (o.mergeBaseBaseline !== null && baseline > o.mergeBaseBaseline)
    return `the baseline (${baseline}) is above the one on the merge base (${o.mergeBaseBaseline}); it may only fall`;
  return null;
}

/** The branch this merges into: a pull request's target (GITHUB_BASE_REF), else main (sixth look W1 named int/rc25 while main had no server baseline; rc.26 put it on main, and an integration branch that is not fetched broke every push build). */
export const baseRefOf = (env: Record<string, string | undefined> = process.env): string =>
  `origin/${env["GITHUB_BASE_REF"] || "main"}`;

/**
 * The baseline as the merge base with the target branch has it: its count; "new" when the file is not there yet (it is new on this branch, which the log says); "unreadable" when the
 * merge base cannot be found (a shallow checkout, no git). On CI an unreadable base fails the ratchet, so the "may only fall" check is never skipped without a word.
 */
export function mergeBaseBaseline(
  root: string,
  file: string,
  ref: string = baseRefOf(),
): { state: "ok"; count: number } | { state: "new" } | { state: "unreadable"; why: string } {
  const mb = spawnSync("git", ["merge-base", ref, "HEAD"], { cwd: root, encoding: "utf8" });
  if (mb.status !== 0)
    return {
      state: "unreadable",
      why: `no merge base with ${ref} (${(mb.stderr || "").trim().slice(0, 120) || "a shallow checkout?"})`,
    };
  const at = mb.stdout.trim();
  const shown = spawnSync("git", ["show", `${at}:${file}`], { cwd: root, encoding: "utf8" });
  if (shown.status !== 0) return { state: "new" };
  try {
    const n = (JSON.parse(shown.stdout) as { count?: unknown }).count;
    return typeof n === "number"
      ? { state: "ok", count: n }
      : { state: "unreadable", why: `${file} on ${ref} has no count` };
  } catch {
    return { state: "unreadable", why: `${file} on ${ref} is not JSON` };
  }
}

/** A CI runner, where a ratchet that cannot count must fail rather than pass. */
export const inCi = (env: Record<string, string | undefined> = process.env): boolean =>
  env["GITHUB_ACTIONS"] === "true" || env["CI"] === "true";

/** The tsconfig and the baseline a run counts against: the app's by default, or the ones named by --project and --baseline. */
export function targetOf(argv: readonly string[]): { project: string; baseline: string; needsReactNative: boolean } {
  const at = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const project = at("--project") ?? "tsconfig.typecheck.json";
  return {
    project,
    baseline: at("--baseline") ?? "scripts/typecheck-baseline.json",
    needsReactNative: project === "tsconfig.typecheck.json",
  };
}

function main(): void {
  const root = process.cwd();
  const target = targetOf(process.argv.slice(2));
  const baselineFile = path.join(root, target.baseline);
  // On a CI runner a skip is a failure: the gates step read "skipped" on every push until 5 Nov while the count drifted to 313, so it passed without counting.
  const skip = (why: string): void => {
    console.log(`typecheck ratchet ${inCi() ? "cannot run" : "skipped"}: ${why}`);
    if (inCi()) process.exit(1);
  };
  if (target.needsReactNative && !fs.existsSync(path.join(root, "node_modules/react-native/package.json")))
    return skip("react-native is not installed here");
  const tsc = [
    process.env["TSC"] ?? "",
    path.join(root, "node_modules/.bin/tsc"),
    path.join(root, "tools/gen/node_modules/.bin/tsc"),
  ].find((p) => p !== "" && fs.existsSync(p));
  if (!tsc) return skip("no tsc installed here");
  const r = spawnSync(tsc, ["-p", target.project], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
  const count = countErrors(`${r.stdout}\n${r.stderr}`);
  const baseline = (JSON.parse(fs.readFileSync(baselineFile, "utf8")) as { count: number }).count;
  const update = process.argv.includes("--update");
  const base = mergeBaseBaseline(root, target.baseline);
  if (base.state === "unreadable" && inCi()) {
    console.log(`typecheck ratchet failed: the baseline on the target branch cannot be read: ${base.why}`);
    process.exit(1);
  }
  if (base.state === "new")
    console.log(`${target.baseline} is new on this branch (not on ${baseRefOf()}): no earlier baseline to hold it to`);
  const why = trustworthy(r, count, baseline, { update, mergeBaseBaseline: base.state === "ok" ? base.count : null });
  if (why !== null) {
    console.log(`typecheck ratchet failed: ${why}`);
    process.exit(1);
  }
  const v = judge(count, baseline);
  console.log(v.words);
  if (update) {
    if (count > baseline) {
      console.error("refusing to raise the baseline");
      process.exit(1);
    }
    fs.writeFileSync(baselineFile, `${JSON.stringify({ count }, null, 2)}\n`);
    return;
  }
  if (!v.ok) process.exit(1);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
