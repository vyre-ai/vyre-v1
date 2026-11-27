// @heavy docker
// The cold open of the browser (rc.44): the Space browser container stays up and only a profile's Chromium sleeps, so the first open after Chromium slept costs a Chromium start, not a container start. This test
// puts the profile's Chromium to sleep N times on a RUNNING container and times the open through the real daemon (the stream call, then the first frame), and also from a stopped container for comparison.
// It prints COLDOPEN with the medians and fails if a cold Chromium on a running container takes more than 1 s at the median (the owner's target).
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
  "cold open of the browser: Chromium asleep on a running container, and from a stopped container, timed through the real daemon",
  { skip, timeout: 900_000 },
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

    const frame1 = async (): Promise<{ call: number; frame: number }> => {
      const a = Date.now();
      const r = await raw("computers.browser.stream", { agentId: agent });
      if (r.status !== 200) throw new Error(`stream ${r.status}`);
      const callMs = ms(a);
      const f0 = Date.now();
      const res = await fetch(`${d.url}${r.data.url}`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
      const rd = res.body!.getReader();
      let got = 0;
      while (got < 2000) {
        const { value, done } = await rd.read();
        if (done) throw new Error("ended");
        got += value.length;
      }
      await rd.cancel();
      return { call: callMs, frame: ms(f0) };
    };
    const sleepChromium = async (): Promise<void> => {
      const r = await docker(
        ["exec", bname, "/opt/browserd/ctl", "stop", JSON.stringify({ profileId: agent })],
        30_000,
      );
      if (r.code !== 0) throw new Error(`could not stop the profile Chromium: ${r.out}`);
    };
    await frame1(); // first use: makes the container and the profile
    const warm: number[] = [];
    const running: Array<{ call: number; frame: number }> = [];
    for (let i = 0; i < N; i++) {
      await sleepChromium();
      const t0 = Date.now();
      const f = await frame1();
      running.push(f);
      warm.push(ms(t0));
    }
    const stopped: number[] = [];
    for (let i = 0; i < Math.min(N, 4); i++) {
      await docker(["stop", "-t", "2", bname], 60_000);
      const t0 = Date.now();
      await frame1();
      stopped.push(ms(t0));
    }
    const m = med(warm);
    console.log(
      `COLDOPEN n=${N} cold Chromium on a running container: median ${m} ms (stream call ${med(running.map((r) => r.call))} ms, first frame ${med(running.map((r) => r.frame))} ms, all ${warm.join(",")}); from a stopped container: median ${med(stopped)} ms`,
    );
    assert.ok(m <= 1000, `cold Chromium on a running container took ${m} ms at the median`);
  },
);
