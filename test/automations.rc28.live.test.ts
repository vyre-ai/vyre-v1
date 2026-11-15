// An Automation made by the RELEASED rc.28 code opens, is edited as a draft, is tested on a real past event, goes live and runs on this branch (AUTOMATIONS-BUILD-RC29 round five, item 6).
// The data folder is made inside the test by the tag's own code: `git archive v1.0.0-rc.28` is unpacked, its daemon is booted on a fresh seeded Space, an Automation is made, turned on and run, and the daemon is stopped; then this tree's daemon opens the same folder.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CORE_SPACE } from "../fixtures/seed/core/index.ts";
import { REPO, startDaemon, stopper } from "../apps/app/tests/real-app-harness.test.ts";

const TAG = "v1.0.0-rc.28";
const ADMIN = "e2e-owner";
void ADMIN;

const MAKE = (out: string): string => `
import fs from "node:fs";
import { bootSpace } from "./apps/app/tests/real-app-harness.test.ts";
const space = await bootSpace();
const post = async (cap, data) => {
  const r = await fetch(space.url + "/v1/" + cap.replace(/\\./g, "/"), { method: "POST", headers: { authorization: "Bearer " + space.token, "content-type": "application/json" }, body: JSON.stringify({ idempotencyKey: cap + Math.random(), ...data }), signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (r.status !== 200) throw new Error(cap + " " + r.status + " " + JSON.stringify(j));
  return j;
};
const who = "usr_olivia";
const made = await post("automations.create", { name: "Made by rc.28", definition: { triggers: [{ key: "manual" }], nodes: [{ id: "n1", key: "create_task", input: { title: "Call back", assigned: { kind: "person", id: who } } }], start: ["n1"] } });
const id = (made.automation ?? made.data?.automation ?? made.data).id;
await post("automations.set_enabled", { automationId: id, enabled: true });
await post("automations.run", { automationId: id, payload: { name: "Sam Reyes" } });
await new Promise((r) => setTimeout(r, 2500));
fs.writeFileSync(${JSON.stringify(out)}, JSON.stringify({ dir: space.dir, id, token: space.token }));
await space.stop();
process.exit(0);
`;

test("an Automation made by the released rc.28 opens, is edited as a draft, tested on a real past event, made live and run on this branch", { timeout: 300_000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-rc28-"));
  const tree = path.join(tmp, "tree");
  fs.mkdirSync(tree);
  const tar = execFileSync("git", ["archive", TAG], { cwd: REPO, maxBuffer: 1 << 30 });
  execFileSync("tar", ["-x", "-C", tree], { input: tar });
  fs.symlinkSync(path.join(REPO, "node_modules"), path.join(tree, "node_modules"));
  const out = path.join(tmp, "made.json");
  fs.writeFileSync(path.join(tree, "make-rc28.mts"), MAKE(out));
  const ran = spawnSync(process.execPath, ["make-rc28.mts"], { cwd: tree, encoding: "utf8", timeout: 120_000 });
  assert.equal(ran.status, 0, `${ran.stdout}\n${ran.stderr}`);
  const { dir, id, token } = JSON.parse(fs.readFileSync(out, "utf8")) as { dir: string; id: string; token: string };

  const d = await startDaemon(dir, ["--space", CORE_SPACE]);
  try {
    const post = async (cap: string, data: Record<string, unknown> = {}): Promise<any> => {
      const r = await fetch(`${d.url}/v1/${cap.replace(/\./g, "/")}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: `${cap}-${Math.random()}`, ...data }),
      });
      const j: any = await r.json().catch(() => ({}));
      assert.equal(r.status, 200, `${cap}: ${JSON.stringify(j)}`);
      return j.data ?? j;
    };
    const got = await post("automations.get", { automationId: id });
    assert.equal(got.automation.name, "Made by rc.28");
    assert.equal(got.automation.status, "on");
    assert.equal(got.automation.definition.nodes.length, 1);
    const def = {
      ...got.automation.definition,
      nodes: [
        ...got.automation.definition.nodes.map((n: any) => ({ ...n, next: ["n2"] })),
        { id: "n2", key: "create_task", input: { title: "Thank them", assigned: { kind: "person", id: "usr_olivia" } } },
      ],
    };
    const saved = await post("automations.draft.save", { automationId: id, definition: def, expectedVersion: got.automation.version });
    assert.equal(saved.draft.rev, 1, "the edit is a draft; the live version did not move");
    assert.equal(saved.automation.version, got.automation.version);
    const events = (await post("automations.test_events", { automationId: id })).events as { runId: string }[];
    assert.ok(events.length >= 1, "the run rc.28 made is a real past event");
    await post("automations.test", { automationId: id, draft: true, eventRunId: events[0]!.runId });
    const live = await post("automations.make_live", { automationId: id });
    assert.equal(live.automation.version, got.automation.version + 1);
    await post("automations.run", { automationId: id, payload: { name: "Jo" } });
    await new Promise((r) => setTimeout(r, 2500));
    const runs = (await post("runs.list", { scope: "subject", subject: { type: "automation", id } })).runs as { status: string; kind: string }[];
    const real = runs.filter((r) => r.kind === "automation");
    assert.ok(real.length >= 2 && real.every((r) => r.status === "succeeded"), JSON.stringify(real));
  } finally {
    await stopper(d.child)();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
