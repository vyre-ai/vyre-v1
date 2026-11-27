// @heavy docker
// Background jobs on a real Docker engine and a booted daemon (27 Nov, rc.44; the owner's 24/7 pattern): a job the agent starts runs under the workspace's supervisor, keeps the computer awake past the idle time, survives a
// restart of the container (what a host reboot does with restart policy unless-stopped) and of the daemon, is started again when it dies, and when it is stopped the computer sleeps by the ordinary rules. Runs only with VYRE_HEAVY_DOCKER=1 and VYRE_WORKSPACE_TEST_IMAGE (a built images/agent-workspace image: it carries the supervisor).
// An agent's workspace on a booted Team daemon with a real Docker engine (6 Nov): nothing is bound in this process, the daemon's own seam gives the terminal module its workspace manager. A
// stand-in model calls terminal_run with no host and no terminal; the command runs in a container made for the agent on that first call, shows under Terminals as a Workspace, the person attaches to
// the same tmux session, and a file the agent makes in ~/Vyre reaches the agent's folder in Files (the mirror, run as the agent). The image is VYRE_WORKSPACE_TEST_IMAGE, or built from images/agent-workspace.
// Runs only with VYRE_HEAVY_DOCKER=1.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot, standIn } from "./memory-live-kit.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { CODE_ROOT } from "../host/src/daemon/daemon.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const PRESET = process.env["VYRE_WORKSPACE_TEST_IMAGE"];
const skip: string | false =
  ON && PRESET ? false : "needs VYRE_HEAVY_DOCKER=1 and VYRE_WORKSPACE_TEST_IMAGE";
const KEYS = {
  personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk",
  publicKey: "cHVibGljLWtleQ==",
  privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk",
  spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }],
};
const PASSWORD = "correct horse battery staple 9";

function docker(args: string[], timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      "docker",
      args,
      { cwd: CODE_ROOT, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          code: err ? (((err as NodeJS.ErrnoException & { code?: number }).code as number | undefined) ?? 1) : 0,
          out: `${stdout}\n${stderr}`,
        });
      },
    );
  });
}
type Reply = { status: number; data: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(d: Daemon, token: string | null, cap: string, input: unknown): Promise<Reply> {
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(input),
  });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}
let keys = 0;
const ok = async (d: Daemon, token: string, cap: string, input: Record<string, unknown>): Promise<any> => {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, token, cap, { idempotencyKey: `ws-${cap}-${++keys}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test(
  "a background job: runs, keeps the computer awake, comes back after a container restart and a daemon restart, restarts when it dies, and lets the computer sleep once stopped",
  { skip, timeout: 420_000 },
  async (t) => {
    const savedImage = process.env["VYRE_WORKSPACE_IMAGE"];
    process.env["VYRE_WORKSPACE_IMAGE"] = PRESET!;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-jobs-"));
    const cfg = () =>
      loadConfig(
        [
          "--data-dir",
          dir,
          "--port",
          "0",
          "--space",
          "spc_jobs",
          "--space-name",
          "Team",
          "--space-kind",
          "team",
          "--role",
          "space",
        ],
        {},
        "1.2.3",
      );
    // the computer is idle after 4 seconds, and the sweep looks every 2
    const opts = { computersSocketPath: "/var/run/docker.sock", computersHomeIntervalMs: 300, workspaceIdleMs: 4000 };
    let d = await boot(dir, standIn, undefined, { config: cfg(), ...opts });
    let wsName = "";
    t.after(async () => {
      await d.stop().catch(() => undefined);
      if (wsName) {
        await docker(["rm", "-f", wsName], 60_000);
        await docker(["volume", "rm", "-f", `${wsName}-home`, `${wsName}-files`, `${wsName}-people`], 60_000);
      }
      if (savedImage === undefined) delete process.env["VYRE_WORKSPACE_IMAGE"];
      else process.env["VYRE_WORKSPACE_IMAGE"] = savedImage;
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
    const device = { deviceName: "Dana's Mac", deviceClass: "desktop" };
    assert.equal(
      (
        await call(d, null, "identity.claim_owner", {
          code,
          spaceId: "spc_jobs",
          username: "dana",
          displayName: "Dana Reyes",
          password: PASSWORD,
          ...device,
          keys: KEYS,
        })
      ).status,
      200,
    );
    const signIn = async (): Promise<string> =>
      (
        (await call(d, null, "identity.sign_in", { username: "dana", password: PASSWORD, ...device })).data.session as {
          token: string;
        }
      ).token;
    let token = await signIn();
    const agent = (
      (await ok(d, token, "agents.create", { name: "Dex", role: "You help." })).agent as { agentId: string }
    ).agentId;
    wsName = `vyre-ws-${agent}`;
    const raw = (cap: string, input: Record<string, unknown>) =>
      call(d, token, cap, { idempotencyKey: `job-${Math.random()}`, ...input });
    const jobs = async (): Promise<Array<Record<string, any>>> => {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await raw("terminal.job.list", { agentId: agent });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      return r.data.jobs as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    const until = async (what: string, f: () => Promise<boolean>, ms = 30_000): Promise<void> => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (await f()) return;
        await sleep(500);
      }
      assert.fail(`not within ${ms} ms: ${what}`);
    };
    const running = async (): Promise<boolean> =>
      (await docker(["inspect", "-f", "{{.State.Running}}", wsName], 20_000)).out.includes("true");

    // 1 a job runs
    const started = await raw("terminal.job.start", {
      agentId: agent,
      name: "ticker",
      command: "while true; do echo tick $(date +%s); sleep 1; done",
      restart: "always",
    });
    assert.equal(started.status, 200, JSON.stringify(started.data));
    const id = started.data.job.jobId as string;
    await until("the job prints", async () =>
      /tick/.test(String((await jobs()).find((j) => j["jobId"] === id)?.["lastLine"] ?? "")),
    );
    assert.equal((await jobs()).find((j) => j["jobId"] === id)?.["state"], "running");
    assert.equal(
      (await docker(["inspect", "-f", "{{.HostConfig.RestartPolicy.Name}}", wsName], 20_000)).out.trim().split("\n")[0],
      "unless-stopped",
    );

    // 2 it keeps the computer awake past the idle time (4 s here): 14 s with nothing else happening
    await sleep(14_000);
    assert.equal(await running(), true, "the computer is still awake: a job is running");
    assert.equal((await jobs()).find((j) => j["jobId"] === id)?.["state"], "running");

    // 3 the container is restarted (a host reboot with unless-stopped does this): the supervisor starts the job again from its folder
    const before = (await docker(["exec", wsName, "sh", "-c", "grep -c tick ~/.vyre/jobs/*/log"], 20_000)).out;
    await docker(["restart", "-t", "2", wsName], 60_000);
    await until(
      "the job is running again after the container restart",
      async () => (await jobs()).find((j) => j["jobId"] === id)?.["state"] === "running",
      40_000,
    );
    await until("and printing", async () => {
      const after = (await docker(["exec", wsName, "sh", "-c", "grep -c tick ~/.vyre/jobs/*/log"], 20_000)).out;
      return Number(after.trim().split("\n")[0]) > Number(before.trim().split("\n")[0]);
    });

    // 4 the daemon is killed and started again: the container and the job are not its to stop
    await d.stop();
    d = await boot(dir, standIn, undefined, { config: cfg(), ...opts });
    token = await signIn();
    assert.equal((await jobs()).find((j) => j["jobId"] === id)?.["state"], "running", "the job outlived the daemon");

    // 5 a job that dies is started again
    await docker(
      ["exec", wsName, "sh", "-c", "pkill -f 'while true; do echo tick' || pkill -f 'sleep 1' || true"],
      20_000,
    );
    await docker(["exec", wsName, "sh", "-c", "pkill -f 'echo tick' || true"], 20_000);
    const pid = (await docker(["exec", wsName, "sh", "-c", "cat ~/.vyre/jobs/*/status.json"], 20_000)).out;
    const supPid = /"pid":(\d+)/.exec(pid)?.[1];
    if (supPid) await docker(["exec", wsName, "sh", "-c", `kill -9 -${supPid} || kill -9 ${supPid} || true`], 20_000);
    await until(
      "the job was started again",
      async () => {
        const j = (await jobs()).find((x) => x["jobId"] === id);
        return j?.["state"] === "running" && Number(j?.["restarts"] ?? 0) >= 1;
      },
      40_000,
    );

    // 6 stopped, the computer sleeps by the ordinary rules
    const stopped = await raw("terminal.job.stop", { agentId: agent, jobId: id });
    assert.equal(stopped.status, 200, JSON.stringify(stopped.data));
    assert.equal(stopped.data.job.state, "stopped");
    await until("the computer sleeps once nothing runs", async () => !(await running()), 60_000);
    assert.deepEqual(await jobs(), [], "asleep: nothing runs, and asking did not wake it");
    assert.equal(await running(), false);
  },
);
