// Two daemons for the "where a chat runs" tests (lane l-runson): a Team Space server (the seeded core Space, the real engine, the fake claude of host/tests/fixtures/fake-cli-driver as the
// model vendor, the real sandbox on the server) and a person's computer (a device-role daemon, as the Vyre app runs it) that links to the Space with the person's own session. The computer's
// engines run the same fake claude, told FAKE_WHERE=device, so every reply says where it ran. Nothing in either daemon is faked; the people's sessions are injected (no sign-in flow here).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalLauncher } from "../../agent/src/drivers/cli/index.ts";
import { fakePlatform } from "../../host/src/platform/index.ts";
import type { FetchFn } from "../../host/src/platform/probes.ts";
import { loadConfig } from "../../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../../host/src/daemon/daemon.ts";
import type { Daemon } from "../../host/src/daemon/daemon.ts";
import type { NodeLauncher, NodeProc } from "../../host/src/compute/node.ts";
import { KEY, connect, hostLog, makeAgent, seededDir, waitFor } from "./live.ts";

export { KEY, hostLog, makeAgent, waitFor };
export const FAKE_CLI = fileURLToPath(new URL("../../host/tests/fixtures/fake-cli-driver/fake-cli.mjs", import.meta.url));
const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

/** The people's own sessions: Olivia on her Mac (a desktop computer) and Noah, a teammate on his. */
export const MAC = "tok-olivia-mac";
export const NOAH = "tok-noah-mac";

export interface SpaceRig { d: Daemon; dir: string; as(token: string | null, cap: string, input: unknown): Promise<{ status: number; data: any } >; stop(): Promise<void> }   // eslint-disable-line @typescript-eslint/no-explicit-any

/** The Team Space server, with Olivia's Claude account connected. */
export async function bootSpace(): Promise<SpaceRig> {
  const dir = seededDir();
  let admin = "";
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space-kind", "team"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "mla-server", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    vault: { secret: async () => KEY, signRs256: async () => "" },
    engineCli: { command: { claude: [process.execPath, FAKE_CLI, "claude"] }, programRead: [path.dirname(FAKE_CLI)] } as never,
    computeStreamSecure: () => true, computeStreamRecheckMs: 200,
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1] ?? "";
      if (t !== "" && t === admin) return { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "local-admin" };
      if (t === MAC) return { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "dev_olivia_mac" };
      if (t === NOAH) return { space: "spc_core", principal: { kind: "person", id: "usr_noah" }, device: "dev_noah_mac" };
      return null;
    },
  });
  admin = d.token;
  await connect(d);
  const as = async (token: string | null, cap: string, input: unknown) => {
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token ?? d.token}` }, body: JSON.stringify(input) });
    const body = (await r.json()) as { data?: unknown; error?: unknown };
    return { status: r.status, data: (body.data ?? body) as any };   // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  return { d, dir, as, stop: async () => { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

export interface DeviceRig { d: Daemon; dir: string; spawns: Array<{ argv: readonly string[]; proc: NodeProc }>; link(space: SpaceRig, token?: string): Promise<void>; unlink(): Promise<void>; stop(): Promise<void> }

/** Olivia's computer: the Vyre app's device daemon. Its engines are the fake claude, told it runs on the device. */
export async function bootDevice(o: { slowMs?: number } = {}): Promise<DeviceRig> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-runson-mac-"));
  const home = path.join(dir, "home");
  fs.mkdirSync(home, { recursive: true });
  const spawns: DeviceRig["spawns"] = [];
  const local = createLocalLauncher({ wrap: (argv) => [process.execPath, FAKE_CLI, ...argv], baseEnv: { PATH: process.env["PATH"] ?? "" } });
  const launcher: NodeLauncher = {
    async spawn(spec) {
      const proc = await local.spawn({ argv: spec.argv, env: { ...spec.env, FAKE_WHERE: "device", HOME: home, ...(o.slowMs !== undefined ? { FAKE_SLOW_MS: String(o.slowMs) } : {}) }, ...(spec.cwd !== undefined ? { cwd: spec.cwd } : {}) });
      spawns.push({ argv: spec.argv, proc });
      return proc;
    },
  };
  const d = await startDaemon({
    config: loadConfig(["--role", "device", "--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "olivia-mac", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" } } }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    deviceLink: { launcher, engines: ["claude_code"], name: "Olivia's Mac", retryMs: 100 },
  });
  let linked: { space: SpaceRig } | null = null;
  const local2 = (method: string, p: string, body?: unknown) => fetch(`${d.url}${p}`, { method, headers: { authorization: `Bearer ${d.token}`, "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return {
    d, dir, spawns,
    async link(space, token = MAC) {
      const r = await local2("POST", "/local/chrome/spaces", { id: "spc_core", name: "Core", address: space.d.url, token });
      assert.equal(r.status, 204, `link: ${r.status}`);
      linked = { space };
      await waitFor(async () => (space.d.nodeRelay.devices("usr_olivia").some((l) => l.deviceId === "dev_olivia_mac" && l.engines.length > 0) ? true : null), 10_000);
    },
    async unlink() {
      const r = await local2("DELETE", "/local/chrome/spaces?id=spc_core");
      assert.equal(r.status, 204, `unlink: ${r.status}`);
      const s = linked?.space;
      if (s) await waitFor(async () => (s.d.nodeRelay.devices("usr_olivia").length === 0 ? true : null), 10_000);
    },
    stop: async () => { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

type Msg = { messageId?: string; author?: { kind?: string; id?: string }; body?: string; threadSeq?: number; blocks?: Array<{ type: string; data?: { state?: string; text?: string } }> };

/** Start a chat as Olivia from her Mac (so the Space knows the computer she is using). */
export async function startChat(s: SpaceRig, agentId: string, key: string, token: string = MAC): Promise<string> {
  const r = await s.as(token, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: `${key}-start` });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.thread.threadId as string;
}

export async function messages(s: SpaceRig, threadId: string): Promise<Msg[]> {
  await s.d.hooks?.pump?.();
  return ((await s.as(null, "chat.messages.list", { threadId })).data.messages as Msg[] | undefined) ?? [];
}

/** Post from her Mac; returns the thread length before, for waiting on what comes after. */
export async function send(s: SpaceRig, threadId: string, agentId: string, body: string, key: string, token: string = MAC): Promise<number> {
  const before = (await messages(s, threadId)).length;
  const r = await s.as(token, "chat.post", { threadId, body, mentions: [{ kind: "agent", id: agentId }], idempotencyKey: `${key}-post` });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return before;
}

export async function replyAfter(s: SpaceRig, threadId: string, before: number, ms = 25_000): Promise<string> {
  return waitFor(async () => {
    const m = (await messages(s, threadId)).slice(before).filter((x) => x.author?.kind === "agent" && (x.body ?? "") !== "").at(-1);
    return m?.body ?? null;
  }, ms, () => hostLog(s.d));
}

/** The turn_status lines in a thread (state and text). */
export async function lines(s: SpaceRig, threadId: string): Promise<Array<{ state: string; text: string }>> {
  return (await messages(s, threadId)).flatMap((m) => (m.blocks ?? []).filter((b) => b.type === "turn_status").map((b) => ({ state: String(b.data?.state ?? ""), text: String(b.data?.text ?? "") })));
}

/** Engine processes the Space started itself: its own opener's pool, which a turn on a computer never touches. */
export async function hostSpawns(s: SpaceRig): Promise<number> {
  const pool = (await s.as(null, "engine.pool.status", {})).data as { sessions: Array<{ hits: number; misses: number }> };
  return pool.sessions.reduce((n, x) => n + x.misses, 0);
}
