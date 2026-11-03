// How a model-list run ends (lane l-winfix): its input closes and it gets time to exit by itself, so `codex app-server` finishes writing models_cache.json. A kill is the last step, for a process
// still running after the grace: on Windows a kill is TerminateProcess, a hard stop mid-write.
import test from "node:test";
import assert from "node:assert/strict";
import { closeGently, listCliModels } from "../src/drivers/cli/models.ts";
import type { CliExit, CliProcess, Launcher } from "../src/drivers/cli/types.ts";

/** A process that answers model/list and then, like codex app-server, exits `exitAfterEofMs` after its input closes (never, when null), writing its cache on the way out. */
function fakeCodex(exitAfterEofMs: number | null) {
  const steps: string[] = [];
  let done!: (e: CliExit) => void;
  const exited = new Promise<CliExit>((r) => { done = r; });
  let queue: string[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  const stdout: AsyncIterable<string> = {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (queue.length > 0) { yield queue.shift()!; continue; }
        if (closed) return;
        await new Promise<void>((r) => { wake = r; });
      }
    },
  };
  const say = (o: unknown) => { queue.push(`${JSON.stringify(o)}\n`); wake?.(); };
  const end = (e: CliExit) => { closed = true; wake?.(); done(e); };
  const proc: CliProcess = {
    pid: 1, stdout, stderrTail: () => "",
    async write(line: string) {
      const j = JSON.parse(line) as { id?: number; method?: string };
      if (j.method === "initialize") say({ id: j.id, result: {} });
      if (j.method === "model/list") say({ id: j.id, result: { data: [{ id: "gpt-6.1-sol", model: "gpt-6.1-sol", displayName: "GPT-6.1-Sol" }], nextCursor: null } });
    },
    endInput() {
      steps.push("eof");
      if (exitAfterEofMs !== null) setTimeout(() => { steps.push("cache written"); end({ code: 0, signal: null }); }, exitAfterEofMs);
    },
    kill(sig) { steps.push(`kill ${sig ?? ""}`.trim()); end({ code: null, signal: sig ?? "SIGTERM" }); },
    exited,
  };
  const launcher: Launcher = { spawn: async () => proc };
  return { steps, launcher, proc };
}

test("codex app-server is not killed: its input closes and it exits after writing its cache", async () => {
  const f = fakeCodex(150);
  const models = await listCliModels(f.launcher, "codex", { graceMs: 2_000 });
  assert.deepEqual(models.map((m) => m.id), ["gpt-6.1-sol"]);
  assert.deepEqual(f.steps, ["eof", "cache written"], "no kill: a kill on Windows is TerminateProcess, which would cut the cache write short");
});

test("a process that does not exit after its input closes is killed after the grace, and the caller waits for it", async () => {
  const f = fakeCodex(null);
  const t0 = Date.now();
  assert.equal(await closeGently(f.proc, 200), "killed");
  assert.deepEqual(f.steps, ["eof", "kill SIGTERM"]);
  assert.ok(Date.now() - t0 >= 190, "the grace was given first");
});

test("a process that ends inside the grace is left alone", async () => {
  const f = fakeCodex(20);
  assert.equal(await closeGently(f.proc, 2_000), "exited");
  assert.deepEqual(f.steps, ["eof", "cache written"]);
});
