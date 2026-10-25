// Two contract changes on different manifests merge in either order with nothing to re-record (the point of docs/frozen/snapshots, lib/snapshot.ts). The test uses real git:
// a base registry with three manifests, a branch that adds a capability to one, a branch that adds an event to another, and both merge orders. It also checks that a snapshot line does not move
// when only the way the registry shares schemas changes, and that two changes to the SAME manifest do conflict (they changed the same contract).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { SNAPSHOT_DIR, snapshotDrift, snapshotFiles } from "../lib/snapshot.ts";
import type { SnapshotRegistry } from "../lib/snapshot.ts";

type Cap = { name: string; v: number; module: string; input: unknown; summary: string };
type Ev = { name: string; module: string; payload: unknown };
interface Reg extends SnapshotRegistry { $defs: Record<string, unknown>; capabilities: Cap[]; events: Ev[] }

const str = { type: "string" };
const base = (): Reg => ({
  $defs: {},
  modules: [{ id: "alpha" }, { id: "beta" }, { id: "gamma" }],
  capabilities: [
    { name: "alpha.get", v: 1, module: "alpha", input: { type: "object", properties: { id: str } }, summary: "Get" },
    { name: "beta.get", v: 1, module: "beta", input: { type: "object", properties: { id: str } }, summary: "Get" },
    { name: "gamma.get", v: 1, module: "gamma", input: { type: "object", properties: { id: str } }, summary: "Get" },
  ],
  events: [{ name: "gamma.made", module: "gamma", payload: { type: "object", properties: { id: str } } }],
});
const withCap = (r: Reg, module: string, name: string): Reg => ({ ...r, capabilities: [...r.capabilities, { name, v: 1, module, input: { type: "object", properties: { x: str } }, summary: name }] });
const withEvent = (r: Reg, module: string, name: string): Reg => ({ ...r, events: [...r.events, { name, module, payload: { type: "object", properties: { y: str } } }] });

function git(dir: string, ...args: string[]): { status: number; out: string } {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" });
  return { status: r.status ?? 1, out: `${r.stdout}${r.stderr}` };
}
function write(dir: string, reg: Reg): void {
  for (const [p, text] of snapshotFiles(reg)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), text); }
}
function onDisk(dir: string, reg: Reg): Map<string, string> {
  const have = new Map<string, string>();
  for (const p of snapshotFiles(reg).keys()) have.set(p, readFileSync(join(dir, p), "utf8"));
  return have;
}
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "snap-merge-"));
  assert.equal(git(dir, "init", "-q", "-b", "main").status, 0);
  write(dir, base());
  git(dir, "add", "-A");
  assert.equal(git(dir, "commit", "-q", "-m", "base").status, 0);
  return dir;
}
function branch(dir: string, name: string, reg: Reg): void {
  assert.equal(git(dir, "checkout", "-q", "-b", name, "main").status, 0);
  write(dir, reg);
  git(dir, "add", "-A");
  assert.equal(git(dir, "commit", "-q", "-m", name).status, 0);
}

test("a capability added to one manifest and an event added to another merge in either order, and the result is exactly what the merged registry gives", () => {
  const a = withCap(base(), "alpha", "alpha.list");
  const b = withEvent(base(), "beta", "beta.changed");
  const both = withEvent(withCap(base(), "alpha", "alpha.list"), "beta", "beta.changed");
  for (const order of [["pr-a", "pr-b"], ["pr-b", "pr-a"]] as const) {
    const dir = repo();
    branch(dir, "pr-a", a);
    branch(dir, "pr-b", b);
    git(dir, "checkout", "-q", "main");
    for (const name of order) {
      const m = git(dir, "merge", "--no-edit", name);
      assert.equal(m.status, 0, `merging ${name} after ${order[0]}: ${m.out}`);
    }
    assert.deepEqual(snapshotDrift(both, onDisk(dir, both)), [], "nothing to re-record after the merge");
  }
});

test("two changes to the same manifest conflict, which is right: they changed the same contract", () => {
  const dir = repo();
  branch(dir, "pr-a", withCap(base(), "alpha", "alpha.list"));
  branch(dir, "pr-b", withCap(base(), "alpha", "alpha.count"));
  git(dir, "checkout", "-q", "main");
  assert.equal(git(dir, "merge", "--no-edit", "pr-a").status, 0);
  assert.notEqual(git(dir, "merge", "--no-edit", "pr-b").status, 0);
});

test("a change to one capability moves one line of one file and no other file", () => {
  const before = snapshotFiles(base());
  const changed = base();
  (changed.capabilities[1] as Cap).input = { type: "object", properties: { id: str, extra: str } };
  const after = snapshotFiles(changed);
  const moved = [...after.keys()].filter((p) => after.get(p) !== before.get(p));
  assert.deepEqual(moved, [`${SNAPSHOT_DIR}/beta.json`]);
  const lines = (t: string): string[] => t.split("\n");
  const diff = lines(after.get(`${SNAPSHOT_DIR}/beta.json`) as string).filter((l, i) => l !== lines(before.get(`${SNAPSHOT_DIR}/beta.json`) as string)[i]);
  assert.equal(diff.length, 1);
  assert.match(diff[0] as string, /"beta.get@1"/);
});

test("how the registry shares schemas does not move a snapshot: a $ref to a shared schema hashes like the schema written out", () => {
  const inline = base();
  const shared: Reg = { ...base(), $defs: { s_1: { type: "object", properties: { id: str } } } };
  (shared.capabilities as Cap[]).forEach((c) => { c.input = { $ref: "#/$defs/s_1" }; });
  (shared.events as Ev[]).forEach((e) => { e.payload = { $ref: "#/$defs/s_1" }; });
  assert.deepEqual([...snapshotFiles(shared)], [...snapshotFiles(inline)]);
});

test("drift is named: a missing file, a changed capability and a stray file", () => {
  const reg = withCap(base(), "alpha", "alpha.list");
  const have = new Map(snapshotFiles(base()));
  have.delete(`${SNAPSHOT_DIR}/gamma.json`);
  have.set(`${SNAPSHOT_DIR}/old.json`, "{}\n");
  const drift = snapshotDrift(reg, have);
  assert.ok(drift.some((d) => d === `missing  ${SNAPSHOT_DIR}/gamma.json`), drift.join("; "));
  assert.ok(drift.some((d) => d.startsWith(`changed  ${SNAPSHOT_DIR}/alpha.json`) && d.includes("alpha.list@1")), drift.join("; "));
  assert.ok(drift.some((d) => d === `stray    ${SNAPSHOT_DIR}/old.json`), drift.join("; "));
});
