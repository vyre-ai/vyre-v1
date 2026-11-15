import test from "node:test";
import assert from "node:assert/strict";
import { findShotsRun, whyShotsNotGreen, WALK_JOBS } from "./shots-gate.ts";
import type { ShotsJob, ShotsRun } from "./shots-gate.ts";
import type { Getter } from "../lib/gh-api.ts";

const SHA = "a".repeat(40);
const INT = "b".repeat(40);
const run = (o: Partial<ShotsRun> = {}): ShotsRun => ({
  id: 10,
  head_sha: SHA,
  status: "completed",
  conclusion: "success",
  event: "push",
  html_url: "https://github.com/o/r/actions/runs/10",
  head_branch: "int/rc29",
  ...o,
});
const green = (): ShotsJob[] => [
  ...WALK_JOBS.map((name) => ({ name, conclusion: "success" })),
  ...Array.from({ length: 36 }, (_, i) => ({ name: `shots (${i})`, conclusion: "success" })),
];

test("a finished green run whose five browser-walk jobs all succeeded counts", () => {
  assert.deepEqual(whyShotsNotGreen(run(), green()), []);
});

test("a red walk job, a red screenshot shard, a missing or skipped walk job and an unfinished run are each refused with the reason", () => {
  const why = (r: ShotsRun, jobs: ShotsJob[]) => whyShotsNotGreen(r, jobs).join(" | ");
  assert.match(why(run({ conclusion: "failure" }), green()), /it failure/);
  assert.match(why(run({ status: "in_progress", conclusion: null }), green()), /it is in_progress/);
  assert.match(
    why(
      run(),
      green().map((j) => (j.name === "release-evidence-walks" ? { ...j, conclusion: "failure" } : j)),
    ),
    /release-evidence-walks is failure.*job release-evidence-walks failure/,
  );
  assert.match(
    why(
      run(),
      green().map((j) => (j.name === "shots (9)" ? { ...j, conclusion: "failure" } : j)),
    ),
    /job shots \(9\) failure/,
  );
  assert.match(
    why(
      run(),
      green().filter((j) => j.name !== "release-evidence-clicks (team)"),
    ),
    /release-evidence-clicks \(team\) is missing/,
  );
  // a short round (workflow_dispatch walks=...) skips release-evidence: not a pass
  assert.match(
    why(
      run(),
      green().map((j) => (j.name === "release-evidence" ? { ...j, conclusion: "skipped" } : j)),
    ),
    /release-evidence is skipped \(a short round/,
  );
});

function fakeApi(o: {
  exact: ShotsRun[];
  recent: ShotsRun[];
  jobs: Record<number, ShotsJob[]>;
  trees: Record<string, string>;
}) {
  const urls: string[] = [];
  const get: Getter = async (url) => {
    urls.push(url);
    const u = new URL(url);
    const page = Number(u.searchParams.get("page") ?? 1),
      per = Number(u.searchParams.get("per_page") ?? 30);
    const slice = <T>(all: T[]) => all.slice((page - 1) * per, page * per);
    if (/\/workflows\/shots\.yml\/runs$/.test(u.pathname)) {
      if (u.searchParams.get("head_sha")) return { status: 200, json: async () => ({ workflow_runs: slice(o.exact) }) };
      assert.equal(u.searchParams.get("status"), "success");
      return { status: 200, json: async () => ({ workflow_runs: o.recent }) };
    }
    const m = /\/runs\/(\d+)\/jobs$/.exec(u.pathname);
    if (m) return { status: 200, json: async () => ({ jobs: slice(o.jobs[Number(m[1])] ?? []) }) };
    const c = /\/git\/commits\/([0-9a-f]{40})$/.exec(u.pathname);
    if (c) return { status: 200, json: async () => ({ tree: { sha: o.trees[c[1]!] ?? "tree-" + c[1] } }) };
    return { status: 404, json: async () => ({}) };
  };
  return { get, urls };
}
const common = { repo: "o/r", sha: SHA, token: "t", pauseMs: 1, sleep: async () => {} };

test("a run on exactly the tagged commit is named", async () => {
  const api = fakeApi({ exact: [run()], recent: [], jobs: { 10: green() }, trees: {} });
  const r = await findShotsRun({ ...common, get: api.get });
  assert.equal(r.found?.run.id, 10);
  assert.equal(r.found?.how, "same commit");
  assert.match(r.found!.line, /^Browser walks: https:\/\/github\.com\/o\/r\/actions\/runs\/10 /);
});

test("a squash commit on main has no run of its own: the green run of the integration head with the same files stands in, a red one does not", async () => {
  const api = fakeApi({
    exact: [],
    recent: [run({ id: 20, head_sha: INT, head_branch: "int/rc28" })],
    jobs: { 20: green() },
    trees: { [SHA]: "same", [INT]: "same" },
  });
  const r = await findShotsRun({ ...common, get: api.get });
  assert.equal(r.found?.run.id, 20);
  assert.equal(r.found?.how, "same files");
  const red = fakeApi({
    exact: [],
    recent: [run({ id: 20, head_sha: INT })],
    jobs: { 20: green().map((j) => (j.name === "release-evidence" ? { ...j, conclusion: "failure" } : j)) },
    trees: { [SHA]: "same", [INT]: "same" },
  });
  const rr = await findShotsRun({ ...common, get: red.get });
  assert.equal(rr.found, null);
  assert.match(rr.refused.join(), /run 20 \(int\/rc29, same files\): release-evidence is failure/);
});

test("no run for the commit, or only runs on other files, finds nothing and says so", async () => {
  const none = await findShotsRun({ ...common, get: fakeApi({ exact: [], recent: [], jobs: {}, trees: {} }).get });
  assert.equal(none.found, null);
  assert.match(none.refused.join(), /no finished shots run for aaaaaaaaaa or for a commit with the same files/);
  const other = fakeApi({
    exact: [],
    recent: [run({ id: 20, head_sha: INT })],
    jobs: { 20: green() },
    trees: { [SHA]: "one", [INT]: "two" },
  });
  assert.equal(
    (await findShotsRun({ ...common, get: other.get })).found,
    null,
    "green on different files proves nothing",
  );
});

test("a lookup that keeps failing throws, so the gate stops the release instead of letting it through", async () => {
  const get: Getter = async () => ({ status: 502, json: async () => ({}) });
  await assert.rejects(findShotsRun({ ...common, get, attempts: 2 }), /github api 502/);
});
