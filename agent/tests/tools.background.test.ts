// A long command the model asked to leave running (r42-runtime): waited for a few seconds like any call; then left running with a node standing for it, which ends when the call does.
import test from "node:test";
import assert from "node:assert/strict";
import { createToolSession } from "../src/tools/index.ts";
import type { BackgroundPort } from "../src/tools/call.ts";
import { ctx, loadGenerated } from "../src/tools/harness.ts";
import { HostError, makeError } from "../../host/src/routes/errors.ts";
import type { Invoke } from "../../host/src/invoke.ts";

function rig(opts: { port?: boolean; beginFails?: boolean; refuse?: boolean; hold?: boolean; quick?: boolean } = {}) {
  const loaded = loadGenerated();
  const sent: Array<Record<string, unknown>> = [];
  const pending: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }> = [];
  const seeds: Array<{ run?: string | undefined }> = [];
  const invoke: Invoke = (cap, input, seed) =>
    new Promise((resolve, reject) => {
      if (cap === "terminal.run") seeds.push({ run: seed.run });
      if (opts.refuse)
        return reject(
          new HostError(
            makeError("permission.role_lacks_permission", "t", { message: "A rule of yours stops that command." }),
          ),
        );
      if (opts.hold) return resolve({ status: "held", taskId: "task_1", traceId: "t" });
      if (cap === "terminal.run") sent.push(input as Record<string, unknown>);
      pending.push({
        resolve: (output) => resolve({ status: "ok", output, traceId: "t" }),
        reject,
      });
      if (opts.quick) pending.pop()!.resolve({ exitCode: 0, output: "ok", durationMs: 5 });
    });
  const began: string[] = [];
  const ended: Array<{ runId: string; ok: boolean; summary: string; code?: string | undefined }> = [];
  const port: BackgroundPort = {
    graceMs: 30,
    begin: async () => {
      if (opts.beginFails) return null;
      began.push("run_node1");
      return { runId: "run_node1" };
    },
    end: async (runId, o) => {
      ended.push({ runId, ...o });
    },
  };
  const session = createToolSession({
    catalog: loaded.catalog,
    defaults: loaded.defaults,
    invoke,
    levelFor: () => "manage",
    canEngineer: () => false,
    localPolicy: () => ({ kind: "allow" }) as never,
    ...(opts.port === false ? {} : { background: port }),
  });
  session.preload("T1", ["terminal_run"]);
  const call = (input: Record<string, unknown>) =>
    session.call(ctx({ turnId: "trn_1", callId: "c1" }), "terminal_run", input);
  return { call, sent, pending, began, ended, seeds };
}
const settle = () => new Promise((r) => setTimeout(r, 15));

test("a command still running after the grace is left running: the model is told at once with a run id, and the word background never reaches the capability", async () => {
  const r = rig();
  const out = await r.call({ command: "npm run build", background: true });
  assert.equal(out.kind, "result");
  const c = (out as { result: { content: Record<string, unknown> } }).result.content;
  assert.equal(c["started"], true);
  assert.equal(c["runId"], "run_node1");
  assert.match(String(c["message"]), /run\.node_ended/);
  assert.equal("background" in r.sent[0]!, false);
  assert.deepEqual(r.ended, [], "it has not ended");
  assert.deepEqual(r.began, ["run_node1"], "the node was made before the command started");
  assert.equal(r.seeds[0]?.run, "run_node1", "and the call carries its id, so a Stop on the node reaches the command");
});

test("when the command ends, its node ends with the exit code and how long it took; a failing exit ends it failed", async () => {
  const r = rig();
  await r.call({ command: "npm run build", background: true });
  r.pending[0]!.resolve({ exitCode: 0, output: "", durationMs: 41 * 60_000 });
  await settle();
  assert.deepEqual(r.ended, [{ runId: "run_node1", ok: true, summary: "Finished, exit 0 after 41 minutes." }]);
  const r2 = rig();
  await r2.call({ command: "make", background: true });
  r2.pending[0]!.resolve({ exitCode: 2, output: "", durationMs: 90_000 });
  await settle();
  assert.equal(r2.ended[0]?.ok, false);
  assert.match(r2.ended[0]!.summary, /exit 2/);
});

test("a call that fails after it was left running ends the node failed with the reason", async () => {
  const r = rig();
  await r.call({ command: "sleep 99", background: true });
  r.pending[0]!.reject(
    new HostError(
      makeError("timeout.deadline", "t", { message: "The command did not finish in time. It was interrupted." }),
    ),
  );
  await settle();
  assert.equal(r.ended[0]?.ok, false);
  assert.equal(r.ended[0]?.code, "timeout.deadline");
});

test("a command that finishes inside the grace answers like any call, and its node ends with it", async () => {
  const r = rig({ quick: true });
  const out = await r.call({ command: "ls", background: true });
  assert.notEqual((out as { result?: { content?: { started?: boolean } } }).result?.content?.started, true);
  await settle();
  assert.equal(r.ended.length, 1);
  assert.equal(r.ended[0]?.ok, true);
});

test("a command that is refused is refused in the background exactly as in the foreground: same error, nothing left running, its node ends failed", async () => {
  const fg = rig({ refuse: true });
  const a = await fg.call({ command: "rm -rf /" });
  const bg = rig({ refuse: true });
  const b = await bg.call({ command: "rm -rf /", background: true });
  assert.equal(a.kind, "error");
  assert.equal(b.kind, "error");
  assert.equal((b as { error: { code: string } }).error.code, (a as { error: { code: string } }).error.code);
  assert.equal((b as { error: { code: string } }).error.code, "permission.role_lacks_permission");
  await settle();
  assert.equal(bg.ended[0]?.ok, false);
  assert.equal(bg.ended[0]?.code, "permission.role_lacks_permission");
});

test("a command that needs a person's yes is held in the background as in the foreground, and its node does not claim to be running", async () => {
  const fg = rig({ hold: true });
  const bg = rig({ hold: true });
  const a = await fg.call({ command: "sudo reboot" });
  const b = await bg.call({ command: "sudo reboot", background: true });
  assert.equal(a.kind, "held");
  assert.equal(b.kind, "held");
  await settle();
  assert.equal(bg.ended[0]?.held, true);
});

test("with no port wired, or when no node can be made, the word is dropped and the command is simply waited for", async () => {
  const none = rig({ port: false });
  const p = none.call({ command: "ls", background: true });
  await settle();
  assert.equal("background" in none.sent[0]!, false);
  none.pending[0]!.resolve({ exitCode: 0, output: "", durationMs: 1 });
  assert.equal((await p).kind, "result");
  const bad = rig({ beginFails: true });
  const q = bad.call({ command: "ls", background: true });
  await settle();
  bad.pending[0]!.resolve({ exitCode: 0, output: "", durationMs: 1 });
  const out = await q;
  assert.equal((out as { result: { content: { started?: boolean } } }).result.content.started, undefined);
});
