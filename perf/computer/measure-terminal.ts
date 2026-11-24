// How long an agent waits for its terminal (lane r42-computer, 19 Nov 2026; owner: "terminal needs to be a whole lot better"). A real workspace container, the agent's `terminal_run` through the tool layer
// (the same path as test/terminal.first-call.heavy.test.ts), and the two things a person's Terminal tab does over and over: read the screen and send a key. Run on a Linux box with Docker:
//   VYRE_WORKSPACE_TEST_IMAGE=vyre/agent-workspace:<tag> node perf/computer/measure-terminal.ts
// It prints one JSON object of milliseconds.
import { execFileSync } from "node:child_process";
import { createLocalHost, handlers } from "../../modules/terminal/impl.ts";
import { bindHost, bindPlace, bindTeam, bindWorkspaces } from "../../modules/terminal/projections.ts";
import type { TermCtx } from "../../modules/terminal/projections.ts";
import { buildWorkspaceManager, workspaceName } from "../../modules/terminal/workspace.ts";
import { unixSocketHttp } from "../../sandbox/src/docker.ts";
import { harness, reset } from "../../modules/terminal/fixtures/harness.ts";
import { createToolSession } from "../../agent/src/tools/index.ts";
import { loadGenerated } from "../../agent/src/tools/harness.ts";

const IMAGE = process.env["VYRE_WORKSPACE_TEST_IMAGE"];
if (!IMAGE) throw new Error("name the image: VYRE_WORKSPACE_TEST_IMAGE");
const ROUNDS = Number(process.env["ROUNDS"] ?? 7) || 7;
const AGENT = `agtpf${process.pid}`;
const NAME = workspaceName(AGENT);
const h = handlers as unknown as Record<string, (ctx: TermCtx, input: any) => Promise<any> | any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
async function timed<T>(f: () => Promise<T>): Promise<[number, T]> {
  const t0 = performance.now();
  const r = await f();
  return [Math.round(performance.now() - t0), r];
}
const sh = (args: string[]): string => {
  try {
    return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return "";
  }
};

const manager = buildWorkspaceManager({ http: unixSocketHttp(), image: IMAGE, idleMs: 600_000, projectsOf: () => [] });
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
    cap === "agents.get" ? { agent: { agentId: AGENT, ownerId: "usr_dana", kind: "assistant" } } : undefined) as never,
};
const loaded = loadGenerated();
const session = createToolSession({
  catalog: loaded.catalog,
  defaults: loaded.defaults,
  levelFor: () => "manage",
  canEngineer: () => false,
  localPolicy: () => ({ action: "run" }) as never,
  invoke: async (cap, input, seed) => ({
    status: "ok",
    output: await h[cap]!(agent, input),
    traceId: seed.trace?.traceId ?? "trace",
  }),
});
session.preload("thr_1", ["terminal_run"]);
let n = 0;
const run = async (command: string): Promise<{ exitCode?: number; output?: string; terminalId?: string }> => {
  n += 1;
  const r = await session.call(
    {
      space: "spc_1",
      agentId: AGENT,
      asker: "usr_dana",
      thread: { threadId: "thr_1", kind: "chat" as const, planMode: false },
      turnId: `trn_pf${n}`,
      callId: `toolu_pf${n}`,
    },
    "terminal_run",
    { command },
  );
  if (r.kind !== "result") throw new Error(`terminal_run failed: ${JSON.stringify(r.result.content).slice(0, 300)}`);
  return ((r.result.content as { data?: Record<string, unknown> }).data ?? {}) as never;
};

const out: Record<string, number | string> = { image: IMAGE, rounds: ROUNDS };
try {
  // 1. nothing exists: the container is made, tmux starts, the command runs
  const [coldMs, first] = await timed(() => run("echo hi"));
  out["first_run_cold_ms"] = coldMs;
  if (first.output !== "hi") throw new Error(`unexpected output ${JSON.stringify(first)}`);
  // 2. everything is up: one short command, start to answer
  const warm: number[] = [];
  for (let i = 0; i < ROUNDS; i++) warm.push((await timed(() => run(`echo warm${i}`)))[0]);
  out["run_warm_ms"] = median(warm);
  // 3. one docker exec that does nothing: the floor under every screen read and key
  const noop: number[] = [];
  for (let i = 0; i < ROUNDS; i++) noop.push((await timed(() => manager.exec(AGENT, ["true"], { quiet: true })))[0]);
  out["exec_overhead_ms"] = median(noop);
  // 4. what a person's Terminal tab does: read the screen (tmux capture-pane with colours), and send one key then read the screen
  const sess = (await manager.exec(AGENT, ["tmux", "list-sessions", "-F", "#{session_name}"], { quiet: true })).stdout
    .trim()
    .split("\n")[0]!;
  const cap: number[] = [];
  const key: number[] = [];
  for (let i = 0; i < ROUNDS; i++) {
    cap.push(
      (await timed(() => manager.exec(AGENT, ["tmux", "capture-pane", "-p", "-e", "-t", sess], { quiet: true })))[0],
    );
    key.push(
      (
        await timed(async () => {
          await manager.exec(AGENT, ["tmux", "send-keys", "-t", sess, "-l", "x"], { quiet: true });
          await manager.exec(AGENT, ["tmux", "capture-pane", "-p", "-e", "-t", sess], { quiet: true });
        })
      )[0],
    );
  }
  out["screen_read_ms"] = median(cap);
  out["key_to_screen_ms"] = median(key);
  await manager.exec(AGENT, ["tmux", "send-keys", "-t", sess, "C-u"], { quiet: true });
  // 5. the workspace slept: the next command wakes it inside the call
  await manager.sleep(AGENT);
  [out["first_run_after_sleep_ms"]] = await timed(() => run("echo again"));
} finally {
  manager.close();
  sh(["rm", "-f", NAME]);
  sh(["volume", "rm", "-f", `${NAME}-home`, `${NAME}-files`, `${NAME}-people`]);
}
console.log(JSON.stringify(out, null, 2));
process.exit(0);
