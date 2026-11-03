// Child Runs on a booted daemon, their second file (the first is runs.children.test.ts): stopping the parent while a child waits, retrying a failed loop or parallel step without running
// again what already succeeded, and a lane that ends early. Both files share runs-children-rig.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { seededDir, bootDaemon, ok, until, note, parallel, automation, runOf, runRow, statusOf, countOf, succeed } from "./runs-children-rig.ts";

test("stopping the parent while a child is waiting does not write the note after that wait", async () => {
  const d = await bootDaemon(seededDir(bootCore));
  try {
    const id = await automation(d, "stop-parent", {
      triggers: [{ key: "manual" }],
      start: ["par"],
      nodes: [
        parallel("par", "all", [{ label: "Wait", to: "pause" }, { label: "Other", to: "other" }], ["join"]),
        { id: "pause", key: "wait", input: { forDuration: "5s" }, next: ["later"] },
        note("later", "After the stopped wait", ["join"]),
        note("other", "Other lane", ["join"]),
        note("join", "Joined after stop"),
      ],
    });
    const runId = await runOf(d, id, "run-stop");
    const childId = await until("a child to park on its wait", 10_000, async () => {
      const listed = (await ok(d, "/v1/runs/list", { scope: "subject", subject: { type: "automation", id }, statuses: ["waiting"], limit: 20 }))["runs"] as { id: string; parentRun?: string }[];
      const child = listed.find((r) => r.parentRun === runId);
      if (!child) return undefined;
      const steps = (await ok(d, "/v1/runs/steps", { runId: child.id }))["steps"] as { step: string; state: string }[];
      return steps.some((s) => s.step === "pause" && s.state === "waiting") ? child.id : undefined;
    });
    assert.equal(await countOf(d, "After the stopped wait"), 0);
    await ok(d, "/v1/runs/stop", { runId, reason: "stop parent" });
    assert.equal(await statusOf(d, runId), "stopped");
    assert.equal(await statusOf(d, childId), "stopped");
    const end = Date.now() + 6_000;
    while (Date.now() < end) {
      assert.equal(await countOf(d, "After the stopped wait"), 0);
      assert.equal(await countOf(d, "Joined after stop"), 0);
      assert.equal(await statusOf(d, runId), "stopped");
      await new Promise((r) => setTimeout(r, 400));
    }
  } finally { await d.stop(); }
});

test("retrying a failed loop does not run again the iterations that already succeeded", async () => {
  const d = await bootDaemon(seededDir(bootCore));
  try {
    const id = await automation(d, "each-retry", {
      triggers: [{ key: "manual" }],
      start: ["each"],
      nodes: [
        { id: "each", key: "loop", input: { items: [{ id: "a", name: "Ada" }, { id: "b", name: "Bea" }, { id: "c", name: "Cy" }], concurrency: 1 }, branches: [{ label: "body", to: "make" }] },
        note("make", "{{ item.name }}", ["check"]),
        { id: "check", key: "if", input: { condition: "item.name == 'Bea'" }, branches: [{ label: "then", to: "boom" }, { label: "else", to: "fine" }] },
        { id: "boom", key: "stop", input: { outcome: "failed", message: "Bea is not ready" } },
        { id: "fine", key: "stop", input: {} },
      ],
    });
    const runId = await runOf(d, id, "run-each-retry");
    const ended = async (rid: string): Promise<void> => { await until("the run to fail", 20_000, async () => { const r = (await ok(d, "/v1/runs/get", { runId: rid }))["run"] as { status?: string }; return r.status === "failed" ? true : undefined; }); };
    await ended(runId);
    assert.equal(await countOf(d, "Ada"), 1);
    const again = String((await ok(d, "/v1/runs/retry", { runId }))["runId"]);
    await ended(again);
    assert.equal(await countOf(d, "Ada"), 1, "Ada went out once, however many times the run is retried");
    assert.equal(await countOf(d, "Bea"), 2, "the iteration that failed ran again");
    // the Automation page retries through its own call, which links the new Run itself
    const third = String((await ok(d, "/v1/automations/retry", { automationId: id, runId: again }))["runId"]);
    await ended(third);
    assert.equal(await countOf(d, "Ada"), 1, "the same through automations.retry");
    assert.equal(await countOf(d, "Bea"), 3);
    assert.equal(await countOf(d, "Cy"), 0, "the item after the failure never started");
  } finally { await d.stop(); }
});

test("retrying a failed parallel step does not run again the lane that already succeeded", async () => {
  const d = await bootDaemon(seededDir(bootCore));
  try {
    const id = await automation(d, "lanes-retry", {
      triggers: [{ key: "manual" }],
      start: ["par"],
      nodes: [
        parallel("par", "all", [{ label: "Good", to: "good" }, { label: "Bad", to: "bad" }], ["join"]),
        note("good", "Good lane", ["join"]),
        note("bad", "Bad lane", ["boom"]),
        { id: "boom", key: "stop", input: { outcome: "failed", message: "This lane is not ready" } },
        note("join", "Joined"),
      ],
    });
    const runId = await runOf(d, id, "run-lanes-retry");
    const ended = async (rid: string): Promise<void> => { await until("the run to fail", 20_000, async () => ((await runRow(d, rid)).status === "failed" ? true : undefined)); };
    await ended(runId);
    assert.equal(await countOf(d, "Good lane"), 1);
    const again = String((await ok(d, "/v1/runs/retry", { runId }))["runId"]);
    await ended(again);
    assert.equal(await countOf(d, "Good lane"), 1, "the lane that succeeded went out once");
    assert.equal(await countOf(d, "Bad lane"), 2, "the lane that failed ran again");
    const third = String((await ok(d, "/v1/automations/retry", { automationId: id, runId: again }))["runId"]);
    await ended(third);
    assert.equal(await countOf(d, "Good lane"), 1, "the same through automations.retry");
    assert.equal(await countOf(d, "Bad lane"), 3);
    assert.equal(await countOf(d, "Joined"), 0, "the step after a parallel that failed never runs, even when no node is common to every lane");
  } finally { await d.stop(); }
});

test("when one lane ends early, the step after the parallel still runs exactly once", async () => {
  const d = await bootDaemon(seededDir(bootCore));
  try {
    const id = await automation(d, "early-lane", {
      triggers: [{ key: "manual" }],
      start: ["par"],
      nodes: [
        parallel("par", "all", [{ label: "Through", to: "through" }, { label: "Short", to: "short" }], ["after"]),
        note("through", "Through lane", ["after"]),
        note("short", "Short lane"),
        note("after", "After the lanes"),
      ],
    });
    await succeed(d, await runOf(d, id, "run-early-lane"), 20_000);
    assert.equal(await countOf(d, "After the lanes"), 1);
  } finally { await d.stop(); }
});
