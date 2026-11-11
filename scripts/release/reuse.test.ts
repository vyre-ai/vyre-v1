import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findReusable, whyNotReusable, wholeSuiteShards, WHOLE_SUITE_PROOF } from "./reuse.ts";
import type { JobInfo, RunInfo } from "./reuse.ts";
import { GithubReleases, publishRelease } from "./publish.ts";
import type { ApiFetch } from "./publish.ts";
import { getAll, getJson } from "../lib/gh-api.ts";
import type { Getter } from "../lib/gh-api.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const SHA = "a".repeat(40);
const run = (o: Partial<RunInfo> = {}): RunInfo => ({ id: 10, head_sha: SHA, status: "completed", conclusion: "success", event: "schedule", html_url: "https://github.com/o/r/actions/runs/10", path: ".github/workflows/main.yml", ...o });
const SHARDS = ["fast-1", "fast-2", "slow-1"];
const green = (): JobInfo[] => [...WHOLE_SUITE_PROOF, "contracts", ...SHARDS].map((name) => ({ name, conclusion: "success" }));

test("a finished, green main.yml run of exactly this commit that ran the whole suite and every planned shard is reusable", () => {
  assert.deepEqual(whyNotReusable(SHA, run(), green(), SHARDS), []);
  assert.deepEqual(whyNotReusable(SHA, run({ event: "workflow_dispatch" }), green(), SHARDS), []);
});

test("every way a run can fall short is refused, with its reason", () => {
  const why = (r: RunInfo, jobs: JobInfo[], shards = SHARDS) => whyNotReusable(SHA, r, jobs, shards).join(" | ");
  assert.match(why(run({ head_sha: "b".repeat(40) }), green()), /not aaaaaaaaaa/, "another commit");
  assert.match(why(run({ status: "in_progress", conclusion: null }), green()), /in_progress/);
  assert.match(why(run({ conclusion: "failure" }), green()), /failure/);
  assert.match(why(run({ conclusion: "cancelled" }), green()), /cancelled/);
  assert.match(why(run({ path: ".github/workflows/check.yml" }), green()), /not \.github\/workflows\/main\.yml/);
  // an affected-only push run: golden-main is skipped, so it was not the whole suite
  const affected = green().map((j) => (j.name.startsWith("golden-main") ? { ...j, conclusion: "skipped" } : j));
  assert.match(why(run({ event: "push" }), affected), /did not run the whole suite \(golden-main-1 is skipped: an affected-only run\)/);
  // a planned shard that is missing, failed or skipped
  assert.match(why(run(), green().filter((j) => j.name !== "slow-1")), /1 of the 3 test jobs .* did not succeed in it \(slow-1\)/);
  assert.match(why(run(), green().map((j) => (j.name === "fast-2" ? { ...j, conclusion: "skipped" } : j))), /\(fast-2\)/);
  assert.match(why(run(), green().map((j) => (j.name === "fast-1" ? { ...j, conclusion: "failure" } : j))), /job fast-1 failure/);
  // a plan that lists nothing proves nothing
  assert.match(why(run(), green(), []), /lists no test job/);
  // a shard that exists in the tag commit's plan but not in the run (a test added since, a shard renamed)
  assert.match(why(run(), green(), [...SHARDS, "slow-2"]), /\(slow-2\)/);
});

function fakeApi(runs: RunInfo[], jobsByRun: Record<number, JobInfo[]>, opts: { failFirst?: number } = {}) {
  const urls: string[] = [];
  let fails = opts.failFirst ?? 0;
  const get: Getter = async (url) => {
    urls.push(url);
    if (fails > 0) { fails--; return { status: 502, json: async () => ({}) }; }
    const u = new URL(url);
    const page = Number(u.searchParams.get("page") ?? 1), per = Number(u.searchParams.get("per_page") ?? 30);
    assert.equal(per, 30, "pages of 30");
    const slice = <T,>(all: T[]) => all.slice((page - 1) * per, page * per);
    if (/\/workflows\/main\.yml\/runs$/.test(u.pathname)) { assert.equal(u.searchParams.get("head_sha"), SHA); return { status: 200, json: async () => ({ workflow_runs: slice(runs) }) }; }
    const m = /\/runs\/(\d+)\/jobs$/.exec(u.pathname);
    if (m) return { status: 200, json: async () => ({ jobs: slice(jobsByRun[Number(m[1])] ?? []) }) };
    return { status: 404, json: async () => ({}) };
  };
  return { get, urls };
}
const common = { repo: "o/r", sha: SHA, shards: SHARDS, token: "t", pauseMs: 1, sleep: async () => {} };

test("the newest qualifying run is named, older refused ones are explained, and a long job list is read page by page", async () => {
  const many = [...green(), ...Array.from({ length: 70 }, (_, i) => ({ name: `extra-${i}`, conclusion: "success" }))];
  const api = fakeApi([run({ id: 12, conclusion: "failure" }), run({ id: 11 }), run({ id: 9, event: "workflow_dispatch" })], { 12: green(), 11: many, 9: green() });
  const r = await findReusable({ ...common, get: api.get });
  assert.equal(r.found?.run.id, 11, "run 12 failed, 11 is the newest green one");
  assert.match(r.refused.join("\n"), /run 12 \(schedule\): it failure/);
  assert.match(r.found!.line, /^Tests: reused the whole-suite run https:\/\/github\.com\/o\/r\/actions\/runs\/10 /, "html_url of the run");
  assert.ok(api.urls.some((u) => u.includes("/runs/11/jobs") && u.includes("page=3")), "the 73 jobs took three pages");
  assert.ok(api.urls.every((u) => u.includes("per_page=30")));
});

test("no run for the commit, or none that qualifies, finds nothing; a lookup that keeps failing throws (the caller then runs the suite)", async () => {
  assert.equal((await findReusable({ ...common, get: fakeApi([], {}).get })).found, null);
  const other = fakeApi([run({ head_sha: "c".repeat(40) })], {});
  const r = await findReusable({ ...common, get: other.get });
  assert.equal(r.found, null);
  assert.match(r.refused.join(), /no finished main\.yml run for aaaaaaaaaa/);
  await assert.rejects(findReusable({ ...common, get: fakeApi([run()], { 10: green() }, { failFirst: 99 }).get }), /github api 502/);
});

test("a 502 is retried with a pause, a 404 is not, and the wait doubles", async () => {
  const api = fakeApi([run()], { 10: green() }, { failFirst: 2 });
  const waits: number[] = [];
  const r = await findReusable({ ...common, get: api.get, pauseMs: 100, sleep: async (ms) => { waits.push(ms); } });
  assert.ok(r.found);
  assert.deepEqual(waits, [100, 200]);
  let calls = 0;
  await assert.rejects(getJson("https://api.github.com/x", { token: "t", get: async () => { calls++; return { status: 404, json: async () => ({}) }; }, sleep: async () => {} }), /github api 404/);
  assert.equal(calls, 1);
  assert.deepEqual(await getAll("https://api.github.com/x", "items", { token: "t", get: async () => ({ status: 200, json: async () => ({ items: [1, 2] }) }) }), [1, 2]);
});

test("the whole-suite plan is read from ci-select's matrix; a failing ci-select is an error, not an empty plan", () => {
  const ok = (args: string[]) => { assert.deepEqual(args, ["scripts/ci-select.ts", "", "--matrix", "--max", "8", "--no-perf"]); return { status: 0, stdout: JSON.stringify({ matrix: { include: [{ name: "fast-1" }, { name: "slow-2" }] } }), stderr: "" }; };
  assert.deepEqual(wholeSuiteShards(root, ok), ["fast-1", "slow-2"]);
  assert.throws(() => wholeSuiteShards(root, () => ({ status: 1, stdout: "", stderr: "boom" })), /ci-select failed \(1\): boom/);
});

test("the real plan of this checkout is a non-empty list of unique job names", () => {
  const names = wholeSuiteShards(root);
  assert.ok(names.length > 0);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.every((n) => /^(fast|slow)-\d+$|^[\w./-]+$/.test(n)), names.join());
});

// reuse as the workflow runs it: usage error, and "no run" is exit 0 with an empty run= in GITHUB_OUTPUT
test("cli reuse: a bad sha is a usage error", () => {
  const p = spawnSync(process.execPath, ["scripts/release/cli.ts", "reuse", "nope"], { cwd: root, env: { ...process.env, GITHUB_REPOSITORY: "o/r", GH_TOKEN: "t" }, encoding: "utf8" });
  assert.equal(p.status, 2);
});

function serve(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, close: () => srv.close() }));
  });
}
const runScript = (args: string[], env: Record<string, string>): Promise<{ code: number | null; out: string }> => new Promise((resolve) => {
  const c = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env } });
  let out = ""; c.stdout.on("data", (d) => { out += d; }); c.stderr.on("data", (d) => { out += d; });
  c.on("close", (code) => resolve({ code, out }));
});

test("cli reuse against a GitHub that answers 502 every time: exit 0, run= empty, the reason is printed", async () => {
  const srv = await serve((_q, res) => { res.statusCode = 502; res.end("{}"); });
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "reuse-")), "out");
  fs.writeFileSync(out, "");
  try {
    const r = await runScript(["scripts/release/cli.ts", "reuse", SHA], { GITHUB_API_URL: srv.url, GITHUB_REPOSITORY: "o/r", GH_TOKEN: "t", GH_API_PAUSE_MS: "1", GITHUB_OUTPUT: out });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /no reusable whole-suite run, so this release ran the whole suite itself \(github api 502/);
    assert.match(fs.readFileSync(out, "utf8"), /^run=$/m);
  } finally { srv.close(); }
});

test("ci-budget: a 502 on the job list is retried; if the API never answers the fallback start measures the budget and still fails a run that is over it", async () => {
  let n = 0;
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const srv = await serve((q, res) => {
    n++;
    if (n <= 2) { res.statusCode = 502; res.end("{}"); return; }
    res.setHeader("content-type", "application/json");
    if (/\/jobs/.test(q.url ?? "")) res.end(JSON.stringify({ jobs: [{ name: "a", started_at: iso(now - 600_000), completed_at: iso(now - 500_000) }] }));
    else res.end(JSON.stringify({ run_started_at: iso(now - 610_000) }));
  });
  try {
    const env = { GITHUB_API_URL: srv.url, GH_TOKEN: "t", GH_API_PAUSE_MS: "1" };
    const a = await runScript(["scripts/ci-budget.ts", "--kind", "tag", "--run-id", "1", "--repo", "o/r", "--fallback-start", iso(now - 60_000)], env);
    assert.equal(a.code, 0, a.out);
    assert.match(a.out, /ok\s+tag budget \(execution\): 10m/, "measured from the API after the retries");
  } finally { srv.close(); }
  const down = await serve((_q, res) => { res.statusCode = 502; res.end("{}"); });
  try {
    const env = { GITHUB_API_URL: down.url, GH_TOKEN: "t", GH_API_PAUSE_MS: "1" };
    const inside = await runScript(["scripts/ci-budget.ts", "--kind", "tag", "--run-id", "1", "--repo", "o/r", "--fallback-start", iso(now - 600_000)], env);
    assert.equal(inside.code, 0, inside.out);
    assert.match(inside.out, /github api 502.*measuring from .* instead/);
    const over = await runScript(["scripts/ci-budget.ts", "--kind", "tag", "--run-id", "1", "--repo", "o/r", "--fallback-start", iso(now - 3_600_000)], env);
    assert.equal(over.code, 1, "an hour is over the 25 minute budget");
    assert.match(over.out, /FAIL tag budget/);
    const none = await runScript(["scripts/ci-budget.ts", "--kind", "tag", "--run-id", "1", "--repo", "o/r"], env);
    assert.equal(none.code, 2, "without a fallback an unreadable API is still an error");
    const report = await runScript(["scripts/ci-report.ts", "--run-id", "1", "--repo", "o/r"], env);
    assert.equal(report.code, 0, "the job-time report does not fail a job for an API outage");
    assert.match(report.out, /job times are not available: github api 502/);
  } finally { down.close(); }
});

test("publish gives a release a cut run made the pre-release mark its channel says, and leaves a right one alone", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pub-pre-"));
  fs.writeFileSync(path.join(dir, "beta.json"), "{}");
  const patches: Array<{ url: string; body: unknown }> = [];
  const make = (prerelease: boolean): ApiFetch => async (url, init) => {
    if (init.method === "GET" && url.includes("/releases/tags/")) return { status: 200, json: async () => ({ id: 7, prerelease, assets: [] }) };
    if (init.method === "PATCH") { patches.push({ url, body: JSON.parse(String(init.body)) }); return { status: 200, json: async () => ({}) }; }
    if (init.method === "POST" && url.includes("/assets?name=")) return { status: 201, json: async () => ({}) };
    return { status: 204, json: async () => ({}) };
  };
  await publishRelease({ repo: "o/r", token: "t", tag: "v1.0.0-rc.1", dir, prerelease: true, notes: "n", fetch: make(false) });
  assert.deepEqual(patches.map((p) => p.body), [{ prerelease: true }]);
  assert.match(patches[0]!.url, /\/releases\/7$/);
  patches.length = 0;
  await publishRelease({ repo: "o/r", token: "t", tag: "v1.0.0-rc.1", dir, prerelease: true, notes: "n", fetch: make(true) });
  assert.deepEqual(patches, [], "already a pre-release");
  await publishRelease({ repo: "o/r", token: "t", tag: "v1.0.0", dir, prerelease: false, notes: "n", fetch: make(true) });
  assert.deepEqual(patches.map((p) => p.body), [{ prerelease: false }], "a stable release is not a pre-release");
  const failing: ApiFetch = async (url, init) => (init.method === "PATCH" ? { status: 422, json: async () => ({}) } : make(false)(url, init));
  await assert.rejects(new GithubReleases("o/r", "t", failing).setPrerelease(7, true), /could not set the pre-release mark/);
});

// fetch-artifacts.sh and retry.sh, with a fake gh on the PATH
function fakeGh(script: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "fake-gh-"));
  fs.writeFileSync(path.join(d, "gh"), `#!/usr/bin/env bash\n${script}\n`, { mode: 0o755 });
  return d;
}
const fetchRun = (bin: string, args: string[], extra: Record<string, string> = {}) => spawnSync("bash", [path.join(here, "fetch-artifacts.sh"), ...args], {
  encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env["PATH"]}`, GH_TOKEN: "t", GITHUB_RUN_ID: "1", GITHUB_REPOSITORY: "o/r", FETCH_PAUSE: "0", FETCH_ATTEMPTS: "3", ...extra },
});
const GH_OK = `# gh run download <id> --repo R -n NAME -D DIR
while [ $# -gt 0 ]; do case "$1" in -n) name="$2"; shift 2;; -D) dir="$2"; shift 2;; *) shift;; esac; done
mkdir -p "$dir" && echo "bytes of $name" > "$dir/$name.bin"`;

test("fetch-artifacts: every artifact lands in its folder, side by side", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-"));
  const r = fetchRun(fakeGh(GH_OK), [`a=${out}/one`, `b=${out}/two`]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(`${out}/one/a.bin`, "utf8"), "bytes of a\n");
  assert.equal(fs.readFileSync(`${out}/two/b.bin`, "utf8"), "bytes of b\n");
});

test("fetch-artifacts: an older gh that nests the artifact in a folder of its name is flattened", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-"));
  const r = fetchRun(fakeGh(GH_OK.replace('mkdir -p "$dir" && echo "bytes of $name" > "$dir/$name.bin"', 'mkdir -p "$dir/$name" && echo "bytes of $name" > "$dir/$name/$name.bin"')), [`a=${out}/one`]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(`${out}/one/a.bin`));
});

test("fetch-artifacts: a try that fails or hangs is tried again; an artifact that never comes fails the job", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-"));
  const count = path.join(out, "count");
  const flaky = fakeGh(`n=$(cat "${count}" 2>/dev/null || echo 0); echo $((n + 1)) > "${count}"\n[ "$n" -ge 2 ] || { echo "connection reset" >&2; exit 1; }\n${GH_OK}`);
  const r = fetchRun(flaky, [`a=${out}/one`]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /try 1 of 3 for a failed: connection reset/);
  assert.match(r.stdout, /fetched a into .* \(try 3 of 3\)/);
  const hang = fetchRun(fakeGh("sleep 30"), [`a=${out}/two`], { FETCH_TRY_SECONDS: "1", FETCH_ATTEMPTS: "2" });
  assert.equal(hang.status, 1, "a hung transfer is cut after its limit and the job fails when it never arrives");
  assert.match(hang.stdout, /could not fetch the artifact a after 2 tries/);
  assert.match(hang.stdout, /FAILED: a/);
  const empty = fetchRun(fakeGh('while [ $# -gt 0 ]; do case "$1" in -D) mkdir -p "$2"; shift 2;; *) shift;; esac; done'), [`a=${out}/three`], { FETCH_ATTEMPTS: "1" });
  assert.equal(empty.status, 1, "an empty download is not a success");
  assert.equal(fetchRun(fakeGh(GH_OK), ["nonsense"]).status, 2);
});

test("retry.sh: a command that passes on a later try passes; one that always fails fails with its own status", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "retry-"));
  const sh = path.join(here, "retry.sh");
  const flaky = path.join(d, "flaky.sh");
  fs.writeFileSync(flaky, `n=$(cat ${d}/n 2>/dev/null || echo 0); echo $((n+1)) > ${d}/n; [ "$n" -ge 1 ]\n`);
  assert.equal(spawnSync("bash", [sh, "3", "0", "bash", flaky]).status, 0);
  assert.equal(spawnSync("bash", [sh, "2", "0", "bash", "-c", "exit 7"]).status, 7);
});
