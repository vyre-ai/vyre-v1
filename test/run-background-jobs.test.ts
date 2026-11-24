// The node of a command left running (r42-runtime): made when the call outlives its grace, kept alive by this process, ended with the call; a server that dies leaves a lease that runs out and the sweep ends it failed.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../modules/runs/fixtures/db.ts";
import { createBackgroundPort } from "../modules/engine/background-jobs.ts";
import { LEASE_TTL_MS } from "../modules/runs/node.ts";

const host = { id: "svc_host", kind: "service" as const };
const tctx = {
  space: "spc",
  agentId: "agt_a",
  asker: "usr_alice",
  thread: { threadId: "thr_1", kind: "chat" },
  turnId: "trn_1",
  callId: "c1",
} as never;
const tool = { name: "terminal_run" } as never;
const world = () => {
  const h = harness();
  const port = createBackgroundPort({ call: (cap, input) => h.call(cap, input, host) }, "host:spc", 20);
  const row = (id: string) =>
    h.sqlite
      .prepare("SELECT status, lease_holder, error_code, summary FROM runs_node WHERE run_id = ?")
      .get(id) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  return { h, port, row };
};

test("a command left running is a node that is running with a lease; its end ends the node done, or failed with the reason", async () => {
  const w = world();
  const a = (await w.port.begin(tctx, tool))!;
  assert.equal(w.row(a.runId)?.status, "running");
  assert.equal(w.row(a.runId)?.lease_holder, "host:spc");
  assert.equal(w.port.running(), 1);
  await w.port.end(a.runId, { ok: true, summary: "Finished, exit 0 after 41 minutes." });
  assert.equal(w.row(a.runId)?.status, "succeeded");
  assert.equal(w.port.running(), 0, "its heartbeat is stopped");
  const b = (await w.port.begin({ ...(tctx as object), callId: "c2" } as never, tool))!;
  await w.port.end(b.runId, { ok: false, summary: "It ended with exit 2.", code: "terminal.nonzero_exit" });
  assert.deepEqual([w.row(b.runId)?.status, w.row(b.runId)?.error_code], ["failed", "terminal.nonzero_exit"]);
});

test("the same call asked twice is the same node, and a person who stopped it first is not overwritten by the command's own end", async () => {
  const w = world();
  const a = (await w.port.begin(tctx, tool))!;
  const again = (await w.port.begin(tctx, tool))!;
  assert.equal(again.runId, a.runId);
  await w.h.call(
    "runs.node.control",
    { runId: a.runId, action: "stop" },
    { id: "usr_alice", kind: "person", depth: 0 },
  );
  await w.port.end(a.runId, { ok: true, summary: "Finished, exit 0." });
  assert.equal(w.row(a.runId)?.status, "stopped");
  assert.equal(w.port.running(), 0);
});

test("the server dies while it waits: the lease runs out and the sweep ends the node failed, saying the command may still be going, and never starts it again", async () => {
  const w = world();
  const a = (await w.port.begin(tctx, tool))!;
  w.h.advance(LEASE_TTL_MS + 1);
  const out = await w.h.call("runs.node.reclaim", {}, host);
  assert.deepEqual(out.reclaimed, [a.runId]);
  const r = w.row(a.runId);
  assert.equal(r?.status, "failed");
  assert.equal(r?.error_code, "worker_lost");
  w.h.advance(1);
  assert.deepEqual((await w.h.call("runs.node.reclaim", {}, host)).reclaimed, []);
  await w.port.end(a.runId, { ok: true, summary: "late" }); // a late end of the dead process changes nothing and throws nothing
  assert.equal(w.row(a.runId)?.status, "failed");
});

test("a command held for approval ends its node as stopped (it has not started), never failed", async () => {
  const w = world();
  const a = (await w.port.begin(tctx, tool))!;
  await w.port.end(a.runId, {
    ok: false,
    held: true,
    summary: "It waits for a person's approval; it starts when allowed.",
  });
  assert.equal(w.row(a.runId)?.status, "stopped");
  assert.equal(w.row(a.runId)?.error_code, null);
});

test("when the claim does not come back the node is not left queued for ever: it is stopped (not started) and the call is simply waited for", async () => {
  const h = harness();
  const port = createBackgroundPort(
    { call: (cap, input) => (cap === "runs.node.claim" ? Promise.resolve({}) : h.call(cap, input, host)) },
    "host:spc",
    20,
  );
  assert.equal(await port.begin(tctx, tool), null);
  const rows = h.sqlite.prepare("SELECT status, stop_reason FROM runs_node").all() as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.deepEqual(
    rows.map((r) => [r.status, r.stop_reason]),
    [["stopped", "not_started"]],
  );
});
