// @heavy docker
// An agent's first terminal_run in a chat where nothing is started, written the way a model writes it (13 Nov 2026, owner on rc.26: "for terminal ... its first attempts are failing always"), through the tool
// layer and a real workspace container: no idempotency key from the model, no workspace made before. The tool layer fills the key, the call waits for the container inside the call, and the answer is the command's.
// The same call after the workspace was put to sleep wakes it inside the call too. Runs only with VYRE_HEAVY_DOCKER=1; VYRE_WORKSPACE_TEST_IMAGE names an image already on the machine.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { CODE_ROOT } from "../host/src/daemon/daemon.ts";
import { createLocalHost, handlers } from "../modules/terminal/impl.ts";
import { bindHost, bindPlace, bindTeam, bindWorkspaces } from "../modules/terminal/projections.ts";
import type { TermCtx } from "../modules/terminal/projections.ts";
import { buildWorkspaceManager, workspaceName } from "../modules/terminal/workspace.ts";
import { unixSocketHttp } from "../sandbox/src/docker.ts";
import { harness, reset } from "../modules/terminal/fixtures/harness.ts";
import { createToolSession } from "../agent/src/tools/index.ts";
import { loadGenerated } from "../agent/src/tools/harness.ts";
import { validateInput } from "../generated/validators.ts";
import { HostError, makeError } from "../host/src/routes/errors.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (the workspace is a real container)";
const PRESET = process.env["VYRE_WORKSPACE_TEST_IMAGE"];
const IMAGE = PRESET ?? `vyre/agent-workspace:fc-${process.pid}${Math.random().toString(36).slice(2, 6)}`;
const AGENT = `agtfc${Math.random().toString(36).slice(2, 8)}`;
const NAME = workspaceName(AGENT);
const h = handlers as unknown as Record<string, (ctx: TermCtx, input: any) => Promise<any> | any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function docker(args: string[], timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      "docker",
      args,
      { cwd: CODE_ROOT, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) =>
        resolve({
          code: err ? (((err as NodeJS.ErrnoException & { code?: number }).code as number | undefined) ?? 1) : 0,
          out: `${stdout}\n${stderr}`,
        }),
    );
  });
}

test(
  "the first terminal_run of a model, with no key and nothing started, runs; so does the first one after a sleep",
  { skip, timeout: 900_000 },
  async (t) => {
    if (PRESET === undefined) {
      const built = await docker(["build", "-t", IMAGE, "images/agent-workspace"], 800_000);
      assert.equal(built.code, 0, built.out.slice(-600));
    }
    const manager = buildWorkspaceManager({
      http: unixSocketHttp(),
      image: IMAGE,
      idleMs: 600_000,
      projectsOf: () => [],
    });
    t.after(async () => {
      manager.close();
      await docker(["rm", "-f", NAME], 60_000);
      await docker(["volume", "rm", "-f", `${NAME}-home`, `${NAME}-files`], 60_000);
      if (PRESET === undefined) await docker(["rmi", "-f", IMAGE], 60_000);
    });
    reset();
    bindTeam(() => true);
    bindWorkspaces(true);
    bindPlace(async () => ({ team: true, agentComputer: false, runsOn: "device", deviceId: "dev_mac" }));
    bindHost(
      createLocalHost(
        {
          exec: async () => ({ code: 127, stdout: "", stderr: "" }),
          shell: async () => ({ exitCode: 1 }),
          home: "/tmp",
          runsHere: () => false,
        },
        manager,
      ),
    );
    const hn = harness();
    const agent: TermCtx = {
      ...hn.as({ kind: "agent", id: AGENT }, "usr_dana", "run_1"),
      thread: "thr_1",
      call: (async (cap: string) =>
        cap === "agents.get"
          ? { agent: { agentId: AGENT, ownerId: "usr_dana", kind: "assistant" } }
          : undefined) as never,
    };
    // the tool layer, with the pipeline's validation and key check in front of the real handler
    const loaded = loadGenerated();
    const sent: unknown[] = [];
    const session = createToolSession({
      catalog: loaded.catalog,
      defaults: loaded.defaults,
      levelFor: () => "manage",
      canEngineer: () => false,
      localPolicy: () => ({ action: "run" }) as never,
      invoke: async (cap, input, seed) => {
        const traceId = seed.trace?.traceId ?? "trace";
        const problems = validateInput(cap, 1, input);
        if (problems.length)
          throw new HostError(makeError("validation.bad_input", traceId, { details: { errors: problems, cap } }));
        sent.push(input);
        return { status: "ok", output: await h[cap]!(agent, input), traceId };
      },
    });
    session.preload("thr_1", ["terminal_run"]);
    const ctx = {
      space: "spc_1",
      agentId: AGENT,
      asker: "usr_dana",
      thread: { threadId: "thr_1", kind: "chat" as const, planMode: false },
      turnId: "trn_fc1",
      callId: "toolu_fc1",
    };

    assert.deepEqual(
      (await manager.list()).filter((w) => w.agentId === AGENT),
      [],
      "nothing is started before the first call",
    );
    const t0 = Date.now();
    const first = await session.call(ctx, "terminal_run", { command: "echo hi" });
    const firstMs = Date.now() - t0;
    assert.equal(first.kind, "result", JSON.stringify(first.kind === "error" ? first.result.content : ""));
    const out = (first.kind === "result" ? first.result.content : {}) as {
      data?: { exitCode?: number; output?: string };
    };
    assert.deepEqual([out.data?.exitCode, out.data?.output], [0, "hi"]);
    assert.match((sent[0] as { idempotencyKey?: string }).idempotencyKey ?? "", /^ag:trn_fc1:toolu_fc1$/);

    assert.equal(await manager.sleep(AGENT), true);
    const w0 = Date.now();
    const woke = await session.call({ ...ctx, turnId: "trn_fc2" }, "terminal_run", { command: "echo again" });
    const wakeMs = Date.now() - w0;
    assert.equal(woke.kind, "result", JSON.stringify(woke.kind === "error" ? woke.result.content : ""));
    assert.equal(
      ((woke.kind === "result" ? woke.result.content : {}) as { data?: { output?: string } }).data?.output,
      "again",
    );
    t.diagnostic(`first call with nothing started ${firstMs} ms, first call after a sleep ${wakeMs} ms`);
  },
);
