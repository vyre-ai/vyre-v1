// @heavy docker
// The open soak (27 Nov, rc.44; owner: "I can't open browser or terminal in Vyre in a stable way"): the calls the app makes to open the terminal and the browser, ten times each, from asleep, from awake and after a daemon
// restart, on a real Docker engine and a booted daemon. Every open must work (0 of 10 may fail) and be quick. Runs only with VYRE_HEAVY_DOCKER=1, VYRE_WORKSPACE_TEST_IMAGE and VYRE_SPACE_BROWSER_IMAGE (built images).
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
const SB = process.env["VYRE_SPACE_BROWSER_IMAGE"];
const skip: string | false =
  ON && PRESET && SB ? false : "needs VYRE_HEAVY_DOCKER=1, VYRE_WORKSPACE_TEST_IMAGE and VYRE_SPACE_BROWSER_IMAGE";
const KEY = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ"; // secret-scan: fake
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

const N = Number(process.env["SOAK_N"] ?? 10);
const ms = (a: number): number => Math.round(Date.now() - a);
const med = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const p90 = (xs: number[]): number =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.9))] ?? 0;

test(
  "open soak: terminal and browser, asleep, awake and after a daemon restart, ten times each, none may fail",
  { skip, timeout: 1_500_000 },
  async (t) => {
    const savedImage = process.env["VYRE_WORKSPACE_IMAGE"];
    process.env["VYRE_WORKSPACE_IMAGE"] = PRESET!;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-soak-"));
    const bname = `vyre-sbrowser-test-soak${process.pid}`;
    process.env["VYRE_SPACE_BROWSER_NAME"] = bname;
    const cfg = () =>
      loadConfig(
        [
          "--data-dir",
          dir,
          "--port",
          "0",
          "--space",
          "spc_soak",
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
    const opts = {
      computersSocketPath: "/var/run/docker.sock",
      computersHomeIntervalMs: 300,
      workspaceIdleMs: 600_000,
    };
    let d = await boot(dir, standIn, undefined, { config: cfg(), ...opts });
    let wsName = "";
    t.after(async () => {
      await d.stop().catch(() => undefined);
      await docker(["rm", "-f", "-v", bname], 60_000);
      await docker(["volume", "rm", "-f", `${bname}-data`], 60_000);
      await docker(["network", "rm", `${bname}net`], 60_000);
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
          spaceId: "spc_soak",
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
      call(d, token, cap, { idempotencyKey: `soak-${Math.random()}`, ...input });
    const report: string[] = [];

    const prompt = async (terminalId: string): Promise<number> => {
      const a = Date.now();
      for (let k = 0; k < 120; k++) {
        const c = await raw("terminal.capture", { terminalId, lines: 50 });
        if (c.status === 200 && typeof c.data.text === "string" && /[$#]\s*$/m.test(c.data.text.trimEnd()))
          return ms(a);
        await new Promise((x) => setTimeout(x, 100));
      }
      throw new Error("no prompt within 12 s");
    };
    // the stream of the terminal's screen (terminal.stream): the ticket is the first message; the time is to the first screen that shows a prompt
    const streamPrompt = async (terminalId: string): Promise<number> => {
      const a = Date.now();
      const r = await raw("terminal.stream", { terminalId });
      if (r.status !== 200) throw new Error(`terminal.stream ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
      assert.ok(!String(r.data.ws).includes("ticket"), "no ticket in the address");
      const ws = new WebSocket(`${d.url.replace(/^http/, "ws")}${r.data.ws}`);
      try {
        return await new Promise<number>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error("no screen with a prompt within 15 s")), 15_000);
          ws.onopen = () => ws.send(JSON.stringify({ t: "hello", ticket: r.data.ticket }));
          ws.onerror = () => reject(new Error("the socket failed"));
          ws.onmessage = (e) => {
            const m = JSON.parse(String(e.data)) as { t: string; text?: string; reason?: string };
            if (m.t === "refused") reject(new Error(`refused: ${m.reason}`));
            if (m.t === "screen" && /[$#]\s*$/m.test((m.text ?? "").trimEnd())) {
              clearTimeout(t);
              resolve(ms(a));
            }
          };
        });
      } finally {
        ws.close();
      }
    };
    const frame = async (): Promise<{ call: number; frame: number }> => {
      const a = Date.now();
      const r = await raw("computers.browser.stream", { agentId: agent });
      if (r.status !== 200) throw new Error(`stream ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
      const callMs = ms(a);
      const f0 = Date.now();
      const res = await fetch(`${d.url}${r.data.url}`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status !== 200 || !res.body) throw new Error(`frame http ${res.status}`);
      const rd = res.body.getReader();
      let got = 0;
      while (got < 2000) {
        const { value, done } = await rd.read();
        if (done) throw new Error("the stream ended before a frame");
        got += value.length;
      }
      await rd.cancel();
      return { call: callMs, frame: ms(f0) };
    };
    const group = async (
      name: string,
      before: () => Promise<void>,
      one: () => Promise<number>,
      budgetP90: number,
    ): Promise<void> => {
      const times: number[] = [];
      const errs: string[] = [];
      for (let i = 0; i < N; i++) {
        try {
          await before();
          times.push(await one());
        } catch (e) {
          errs.push((e as Error).message);
        }
      }
      report.push(
        `${name}: ok ${times.length}/${N}, median ${med(times)} ms, p90 ${p90(times)} ms${errs.length ? `, errors ${JSON.stringify(errs.slice(0, 3))}` : ""}`,
      );
      assert.equal(errs.length, 0, `${name}: ${errs.join(" | ")}`);
      assert.ok(p90(times) <= budgetP90, `${name}: p90 ${p90(times)} ms is over ${budgetP90} ms`);
    };

    const tid = (await raw("terminal.open", { host: "agent_computer", agentId: agent, own: true })).data.terminal
      .terminalId as string;
    await group(
      "terminal from asleep",
      async () => void (await docker(["stop", "-t", "2", wsName], 60_000)),
      () => prompt(tid),
      6000,
    );
    await group(
      "terminal awake",
      async () => undefined,
      () => prompt(tid),
      1500,
    );
    await group(
      "terminal stream from asleep",
      async () => void (await docker(["stop", "-t", "2", wsName], 60_000)),
      () => streamPrompt(tid),
      6000,
    );
    await group(
      "terminal stream awake",
      async () => undefined,
      () => streamPrompt(tid),
      1500,
    );
    await group(
      "browser from asleep",
      async () => {
        // really cold: the Space browser's container is stopped and read back as stopped before the open is timed
        await docker(["stop", "-t", "2", bname], 60_000);
        const state = (await docker(["inspect", "-f", "{{.State.Running}}", bname], 20_000)).out;
        if (state.includes("true")) throw new Error("the Space browser container did not stop");
      },
      async () => {
        const a = Date.now();
        const r = await frame();
        // the whole open, from the call to the first frame: the cold start is in the call
        return ms(a) + 0 * r.frame;
      },
      6000,
    );
    await group(
      "browser awake",
      async () => undefined,
      async () => (await frame()).frame,
      1000,
    );
    await group(
      "after a daemon restart, terminal",
      async () => {
        await d.stop();
        d = await boot(dir, standIn, undefined, { config: cfg(), ...opts });
        token = await signIn();
      },
      () => prompt(tid),
      2500,
    );
    await group(
      "after a daemon restart, terminal stream",
      async () => {
        await d.stop();
        d = await boot(dir, standIn, undefined, { config: cfg(), ...opts });
        token = await signIn();
      },
      () => streamPrompt(tid),
      2500,
    );
    await group(
      "after a daemon restart, browser",
      async () => {
        await d.stop();
        d = await boot(dir, standIn, undefined, { config: cfg(), ...opts });
        token = await signIn();
      },
      async () => (await frame()).frame,
      2500,
    );
    console.log(`SOAK\n${report.join("\n")}`);
  },
);
