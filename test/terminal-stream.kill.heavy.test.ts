// @heavy docker
// A real crash under an open terminal stream (27 Nov, rc.44; the update and crash case): the daemon runs as a CHILD PROCESS (node host/src/daemon/main.ts, a Personal Space on the machine's Docker), a client holds
// the terminal's live stream (terminal.stream, the ticket as the first message) through the same reconnecting model the app uses (surface.ts) and builds the screen from the numbered changes (terminal-feed.ts). The
// daemon is killed with SIGKILL, a new process starts on the same data and port, and the stream must come back by itself with the screen as it was and carry what is typed after. The time from the kill to the
// first screen on the new process is printed. Runs only with VYRE_HEAVY_DOCKER=1 and VYRE_WORKSPACE_TEST_IMAGE (a built images/agent-workspace image).
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
  ON && PRESET ? false : "needs VYRE_HEAVY_DOCKER=1, VYRE_WORKSPACE_TEST_IMAGE and VYRE_SPACE_BROWSER_IMAGE";
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

import { spawn } from "node:child_process";
import net from "node:net";
import type { ChildProcess } from "node:child_process";
import { createSurface } from "../apps/app/src/places/chats/rightpane/surface.ts";
import { EMPTY_FEED, applyFeed, parseFeed } from "../apps/app/src/places/chats/rightpane/terminal-feed.ts";
import type { Feed } from "../apps/app/src/places/chats/rightpane/terminal-feed.ts";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });

test(
  "the daemon is killed (SIGKILL) as a child process under an open terminal stream: a new process on the same data and port, and the stream is back by itself with the screen and the numbering",
  { skip, timeout: 420_000 },
  async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-kill-"));
    const port = await freePort();
    const children: ChildProcess[] = [];
    let out = "";
    const startChild = async (): Promise<{ child: ChildProcess; claim?: string }> => {
      out = "";
      const child = spawn(
        process.execPath,
        [
          "host/src/daemon/main.ts",
          "--data-dir",
          dir,
          "--port",
          String(port),
          "--space",
          "spc_kill",
          "--space-name",
          "Personal",
          "--space-kind",
          "personal",
          "--role",
          "space,device",
        ],
        { cwd: CODE_ROOT, env: { ...process.env, VYRE_WORKSPACE_IMAGE: PRESET! }, stdio: ["ignore", "pipe", "pipe"] },
      );
      children.push(child);
      child.stdout!.on("data", (b: Buffer) => (out += b.toString()));
      child.stderr!.on("data", (b: Buffer) => (out += b.toString()));
      const t0 = Date.now();
      while (!/listening on http/.test(out)) {
        if (child.exitCode !== null) throw new Error(`the daemon exited ${child.exitCode}: ${out.slice(-600)}`);
        if (Date.now() - t0 > 90_000) throw new Error(`the daemon did not start: ${out.slice(-600)}`);
        await sleep(100);
      }
      return {
        child,
        ...(/claim this Space[^:]*: (\S+)/i.exec(out) ? { claim: /Claim this Space[^:]*: (\S+)/.exec(out)![1]! } : {}),
      };
    };
    let wsName = "";
    t.after(async () => {
      for (const c of children) if (c.exitCode === null) c.kill("SIGKILL");
      if (wsName) {
        await docker(["rm", "-f", wsName], 60_000);
        await docker(["volume", "rm", "-f", `${wsName}-home`, `${wsName}-files`, `${wsName}-people`], 60_000);
      }
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const url = `http://127.0.0.1:${port}`;
    const first = await startChild();
    assert.ok(first.claim, `the new daemon prints its claim link: ${out.slice(0, 400)}`);
    const claimCode = decodeURIComponent(new URL(first.claim!).pathname.split("/").pop() ?? "");
    const api = async (
      token: string | null,
      cap: string,
      input: Record<string, unknown>,
    ): Promise<{ status: number; data: any }> => {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await fetch(`${url}/v1/${cap.replaceAll(".", "/")}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ idempotencyKey: `kill-${Math.random()}`, ...input }),
      });
      const body = (await r.json()) as { data?: unknown };
      return { status: r.status, data: body.data ?? body };
    };
    const device = { deviceName: "Dana's Mac", deviceClass: "desktop" };
    assert.equal(
      (
        await api(null, "identity.claim_owner", {
          code: claimCode,
          spaceId: "spc_kill",
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
        (await api(null, "identity.sign_in", { username: "dana", password: PASSWORD, ...device })).data.session as {
          token: string;
        }
      ).token;
    let token = await signIn();
    const ok2 = async (cap: string, input: Record<string, unknown>): Promise<any> => {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      let r = await api(token, cap, input);
      if (r.status === 401) {
        token = await signIn();
        r = await api(token, cap, input);
      }
      assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data).slice(0, 300)}`);
      return r.data;
    };
    const agent = ((await ok2("agents.create", { name: "Dex", role: "You help." })).agent as { agentId: string })
      .agentId;
    wsName = `vyre-ws-${agent}`;
    const tid = (await ok2("terminal.open", { host: "agent_computer", agentId: agent, own: true })).terminal
      .terminalId as string;
    await ok2("terminal.capture", { terminalId: tid, lines: 20 });
    const type = (text: string): Promise<unknown> => ok2("terminal.input", { terminalId: tid, data: `${text}\r` });

    // the client: the app's own reconnecting model and the screen built from the numbered changes
    let feed: Feed = EMPTY_FEED;
    const states: string[] = [];
    let socket: WebSocket | null = null;
    let screens = 0;
    let lastScreenAt = 0;
    const surface = createSurface<{ ws: string; ticket: string }>({
      open: async () => {
        const r = await api(token, "terminal.stream", { terminalId: tid });
        if (r.status === 401) token = await signIn();
        if (r.status !== 200) throw new Error(`terminal.stream ${r.status}`);
        return r.data as { ws: string; ticket: string };
      },
      onState: (s) => void states.push(s.kind),
      onOpened: (o) => {
        socket?.close();
        const ws = new WebSocket(`${url.replace(/^http/, "ws")}${o.ws}`);
        socket = ws;
        ws.onopen = () =>
          ws.send(
            JSON.stringify({ t: "hello", ticket: o.ticket, ...(feed.rev === undefined ? {} : { rev: feed.rev }) }),
          );
        ws.onmessage = (e) => {
          const m = parseFeed(String(e.data));
          if (!m) return;
          const r = applyFeed(feed, m);
          feed = r.feed;
          if (m.t === "screen" || m.t === "diff" || m.t === "ok") {
            screens++;
            lastScreenAt = Date.now();
            surface.connected();
          }
          if (r.resync) ws.send(JSON.stringify({ t: "resync" }));
        };
        ws.onclose = () => surface.lost("closed");
        ws.onerror = () => surface.lost("error");
      },
    });
    surface.start();
    const until = async (what: string, f: () => boolean, ms2 = 30_000): Promise<void> => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms2) {
        if (f()) return;
        await sleep(100);
      }
      assert.fail(`not within ${ms2} ms: ${what}`);
    };
    const text = (): string => feed.lines.join("\n");

    await until("the first screen", () => screens > 0);
    await type("echo before-the-kill");
    await until("what was typed shows on the stream", () => text().includes("before-the-kill"));
    const revBefore = feed.rev;
    assert.ok(revBefore !== undefined && revBefore >= 1, "numbered changes arrived");

    // the crash: SIGKILL, no goodbye; a new process on the same data and the same port
    const t0 = Date.now();
    const screensBefore = screens;
    first.child.kill("SIGKILL");
    await until(
      "the old process is gone",
      () => first.child.exitCode !== null || first.child.signalCode !== null,
      10_000,
    );
    const second = await startChild();
    void second;
    await until(
      "the stream is back by itself and sent a screen",
      () => screens > screensBefore && lastScreenAt > t0,
      90_000,
    );
    const recoveryMs = Date.now() - t0;
    assert.ok(
      text().includes("before-the-kill"),
      "the screen is as it was: what was typed before the kill is still there",
    );
    assert.ok(states.includes("reconnecting"), `it said it was reconnecting (${states.join(",")})`);
    assert.equal(surface.state().kind, "ready");
    // and it carries what is typed after
    await type("echo after-the-kill");
    await until("what is typed after the kill shows on the stream", () => text().includes("after-the-kill"));
    console.log(
      `KILLRECOVERY SIGKILL of the daemon under an open terminal stream: first screen on the new process after ${recoveryMs} ms, no click; numbering ${revBefore} before, ${feed.rev} after (a new process holds no history, so it sends the whole screen first); states ${states.join(">")}`,
    );
    surface.dispose();
    socket?.close();
  },
);
