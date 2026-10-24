import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runChecks, verdict, SPIKES, type Ports, type Packet, type Run } from "./g0-check.ts";

const CHECK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "g0-check.ts");
const put = (root: string, rel: string, text = "x") => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };

/** A repo that satisfies every condition. */
function fixture(): string {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), "g0-"));
  put(r, "package.json", "{}"); put(r, "manifest/package.json"); put(r, "generated/hash.txt", "a".repeat(64)); put(r, "generated/registry.json", "{}");
  put(r, "contracts/src/a.ts", "export const a = 1;"); put(r, "contracts/tests/frozen-events.test.ts"); put(r, "kernel/src/a.ts");
  put(r, "host/modules.json", JSON.stringify({ modules: Array.from({ length: 72 }, (_, i) => ({ id: `m${i}`, owner: "L1", status: "stub" })) }));
  put(r, "scripts/lanes-check.ts"); put(r, "scripts/lanes.json", JSON.stringify({ lanes: [{ id: "L1" }, { id: "L2" }] }));
  put(r, "docs/lanes/L1.md"); put(r, "docs/lanes/L2.md");
  put(r, "host/src/a.ts"); put(r, "testkit/a.ts"); put(r, "fixtures/seed/a.ts");
  put(r, "spikes/REPORT.md", SPIKES.join(" ")); put(r, "sync/src/protocol.ts");
  for (let i = 0; i < 22; i++) put(r, `ui/src/C${i}/props.ts`);
  for (const f of ["ci-select", "ci-budget", "workflows.test"]) put(r, `scripts/${f}.ts`);
  put(r, "docs/ci/skeleton-run.md", "| Execution (first job start to last job end) | 45 s | under 90 s |\n");
  put(r, "manifests/chat.ts"); put(r, "scripts/import-0.6.ts"); put(r, "docs/import-log/a.md");
  put(r, "docs/dry-run-hour1.md", "Median lead review time per packet: 4 min. CI push wall: 80 s.");
  return r;
}
const good: Run = { conclusion: "success", jobs: [{ name: "budget", conclusion: "success" }] };
const prep: Packet[] = [{ id: "P-PR_1", status: "done" }, { id: "P-PR_47b", status: "ready" }, { id: "P-PR_64", status: "ready" }, { id: "P-PR_75", status: "in_progress" }];
const ports = (root: string, over: Partial<Ports> = {}): Ports => ({ root, packets: () => prep, mainRun: () => good, exec: () => ({ ok: true, out: "" }), ...over });
const failed = async (root: string, over: Partial<Ports> = {}) => (await runChecks(ports(root, over))).filter((l) => !l.ok).map((l) => l.id);

test("a complete repo passes every F item and gate condition, with F14 shown as waived", async () => {
  const lines = await runChecks(ports(fixture()));
  assert.deepEqual(lines.filter((l) => !l.ok), []);
  assert.equal(lines.find((l) => l.id === "F14")?.waived, true);
  assert.equal(lines.filter((l) => /^F\d+$/.test(l.id)).length, 15);
  assert.equal(verdict(lines).ok, true);
});

const removals: [string, string][] = [
  ["F1", "manifest"], ["F2", "contracts"], ["F3", "kernel"], ["F4", "host/modules.json"], ["F5", "host/src"], ["F6", "testkit"], ["F7", "spikes/REPORT.md"],
  ["F8", "sync/src/protocol.ts"], ["F9", "ui/src"], ["F10", "docs/ci/skeleton-run.md"], ["F11", "manifests"], ["F12", "docs/import-log"], ["F13", "docs/lanes/L2.md"],
  ["contract-hash", "generated/hash.txt"], ["dry-run", "docs/dry-run-hour1.md"],
];
for (const [id, rel] of removals) {
  test(`g0 reports ${id} when ${rel} is missing`, async () => {
    const r = fixture(); fs.rmSync(path.join(r, rel), { recursive: true });
    assert.ok((await failed(r)).includes(id), `${id} should fail`);
    assert.equal(verdict(await runChecks(ports(r))).ok, false);
  });
}

test("g0 reports the other ways an item fails", async () => {
  const slow = fixture(); put(slow, "docs/ci/skeleton-run.md", "| Execution | 120 s | |\n");
  assert.deepEqual((await failed(slow)).sort(), ["F10", "budgets"]);
  const todo = fixture(); put(todo, "contracts/src/a.ts", "// TODO fill\n");
  assert.deepEqual(await failed(todo), ["F2"]);
  const few = fixture(); put(few, "host/modules.json", JSON.stringify({ modules: [{ id: "a", owner: "L1", status: "stub" }] }));
  assert.deepEqual(await failed(few), ["F4"]);
  const spk = fixture(); put(spk, "spikes/REPORT.md", "S0 S1");
  assert.deepEqual(await failed(spk), ["F7"]);
  assert.deepEqual(await failed(fixture(), { exec: () => ({ ok: false, out: "boom" }) }), ["F1", "F4"]);
});

test("g0 reports an open prep packet, a red or absent main run and a failed budget job", async () => {
  const r = fixture();
  assert.deepEqual(await failed(r, { packets: () => [...prep, { id: "P-PR_61", status: "in_review" }] }), ["packets"]);
  assert.deepEqual(await failed(r, { packets: () => [] }), ["packets"]);
  assert.deepEqual((await failed(r, { mainRun: () => ({ conclusion: "failure", jobs: [] }) })).sort(), ["F15", "budgets", "main-green"]);
  assert.deepEqual((await failed(r, { mainRun: () => null })).sort(), ["F15", "budgets", "main-green"]);
  assert.deepEqual(await failed(r, { mainRun: () => ({ conclusion: "success", jobs: [{ name: "budget", conclusion: "failure" }] }) }), ["budgets"]);
});

test("the command exits nonzero on an empty repo and zero on a complete one", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "g0-empty-"));
  const bad = spawnSync(process.execPath, [CHECK, "--root", empty, "--skip-remote"], { encoding: "utf8" });
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /G0: NOT READY/);
  const r = fixture(); const pj = path.join(r, "packets.json"); fs.writeFileSync(pj, JSON.stringify(prep));
  const ran = spawnSync(process.execPath, [CHECK, "--root", r, "--packets-json", pj, "--skip-remote"], { encoding: "utf8" });
  assert.equal(ran.status, 1, "main-green cannot be proven with --skip-remote");
  assert.match(ran.stdout, /FAIL main-green/);
  // F1 and F4 shell out to gen and lanes-check, which the fixture does not have; everything else must be green but the remote lines
  assert.doesNotMatch(ran.stdout, /FAIL F13:|FAIL packets|FAIL contract-hash|FAIL dry-run/);
});
