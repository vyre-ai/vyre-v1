// Two daemons for the "where a chat runs" tests (lane l-runson): a Team Space server (the seeded core Space, the real engine, the fake claude of host/tests/fixtures/fake-cli-driver as the
// model vendor, the real sandbox on the server) and a person's computer (a device-role daemon, as the Vyre app runs it) that links to the Space with the person's own session. The computer's
// engines run the same fake claude, told FAKE_WHERE=device, so every reply says where it ran, and they run the way the engine module runs them on a computer: spawnCli inside this machine's real
// sandbox, in the work folder the link names, under the turn's network rule. Only the program is swapped (as the server's engineCli does). The people's sessions are injected (no sign-in flow here).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultSandbox } from "../../modules/engine/sandbox-default.ts";
import { spawnCli } from "../../modules/engine/session.ts";
import { workFolder } from "../../modules/engine/sandbox.ts";
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

/** A stopped daemon's folder is removed at once, with no retries: a handle it kept would stop an update or an uninstall too. When it cannot be, the files still held are named. */
function rmStrict(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {
    const held: string[] = [];
    const walk = (p: string): void => {
      let st: fs.Stats; try { st = fs.lstatSync(p); } catch { return; }
      if (st.isDirectory()) { for (const n of fs.readdirSync(p)) walk(path.join(p, n)); return; }
      try { fs.unlinkSync(p); } catch (x) { held.push(`${path.relative(dir, p)} (${(x as NodeJS.ErrnoException).code})`); }
    };
    walk(dir);
    throw new Error(`the stopped daemon still holds ${held.join(", ") || dir}: ${(e as Error).message}`);
  }
}

export interface SpaceRig { d: Daemon; dir: string; /** the address a computer links to: loopback, or this machine's private address for a LAN Space */ address: string; as(token: string | null, cap: string, input: unknown): Promise<{ status: number; data: any } >; stop(): Promise<void> }   // eslint-disable-line @typescript-eslint/no-explicit-any

/** An address of this machine on its private network (not loopback): a Space there is reached by an engine only through its wall, the way a LAN Space is. */
export function lanAddress(): string {
  for (const list of Object.values(os.networkInterfaces())) for (const a of list ?? []) if (a.family === "IPv4" && !a.internal && /^(10\.|192\.168\.)/.test(a.address)) return a.address;
  throw new Error("this machine has no private network address for the LAN Space test");
}

/** The Team Space server, with Olivia's Claude account connected. `lan`: it listens on this machine's private address instead of loopback, so a sandboxed engine reaches it only through its wall. */
export async function bootSpace(o: { lan?: boolean } = {}): Promise<SpaceRig> {
  const dir = seededDir();
  let admin = "";
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space-kind", "team", ...(o.lan ? ["--host", "0.0.0.0"] : [])], {}, "1.2.3"),
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
  // the test's own calls (and the owner's key, which goes to loopback only) use this machine's loopback; a computer links at the LAN address when `lan`
  const loop = `http://127.0.0.1:${d.port}`;
  await connect(Object.assign(Object.create(d) as Daemon, { url: loop }));
  const address = o.lan ? `http://${lanAddress()}:${d.port}` : d.url;
  const as = async (token: string | null, cap: string, input: unknown) => {
    const r = await fetch(`${loop}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token ?? d.token}` }, body: JSON.stringify(input) });
    const body = (await r.json()) as { data?: unknown; error?: unknown };
    return { status: r.status, data: (body.data ?? body) as any };   // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  return { d, dir, address, as, stop: async () => { await d.stop(); rmStrict(dir); } };
}

export interface DeviceRig { d: Daemon; dir: string; home: string; spawns: Array<{ argv: readonly string[]; env: Record<string, string>; proc: NodeProc }>; link(space: SpaceRig, token?: string): Promise<void>; unlink(): Promise<void>; stop(): Promise<void> }

/** Olivia's computer: the Vyre app's device daemon. Its engines are the fake claude, told it runs on the device, started in this computer's own sandbox. */
export async function bootDevice(o: { slowMs?: number; signedIn?: "claude" } = {}): Promise<DeviceRig> {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-runson-mac-")));
  // her own home on this computer: signed in to Claude Code here when the test says so (a sign-in file in ~/.claude, as on Linux)
  const home = path.join(dir, "home-olivia");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  if (o.signedIn === "claude") fs.writeFileSync(path.join(home, ".claude", ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "her-own-mac-sign-in" } }), { mode: 0o600 });
  const spawns: DeviceRig["spawns"] = [];
  // this computer's own sandbox (not the module's shared default, which in this one test process belongs to the server)
  const sandbox = await defaultSandbox({ dataDir: dir, programRead: [path.dirname(FAKE_CLI)] });
  const launcher: NodeLauncher = {
    workFolder: (person, proc) => workFolder(dir, person, proc),
    async spawn(spec) {
      const proc = await spawnCli(sandbox.plan, { argv: spec.argv, env: { ...spec.env, FAKE_WHERE: "device", ...(o.slowMs !== undefined ? { FAKE_SLOW_MS: String(o.slowMs) } : {}) }, ...(spec.cwd !== undefined ? { cwd: spec.cwd } : {}) }, [process.execPath, FAKE_CLI, ...spec.argv]);
      spawns.push({ argv: spec.argv, env: { ...spec.env }, proc: proc as unknown as NodeProc });
      return proc as unknown as NodeProc;
    },
  };
  const d = await startDaemon({
    config: loadConfig(["--role", "device", "--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "olivia-mac", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" } } }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    deviceLink: { launcher, engines: ["claude_code"], name: "Olivia's Mac", retryMs: 100, homes: { home, env: {}, platform: "linux", exists: (p) => fs.existsSync(p) } },
  });
  let linked: { space: SpaceRig } | null = null;
  const local2 = (method: string, p: string, body?: unknown) => fetch(`${d.url}${p}`, { method, headers: { authorization: `Bearer ${d.token}`, "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return {
    d, dir, home, spawns,
    async link(space, token = MAC) {
      const r = await local2("POST", "/local/chrome/spaces", { id: "spc_core", name: "Core", address: space.address, token });
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
    stop: async () => { await d.stop(); await sandbox.close(); rmStrict(dir); },
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

// ---- approvals: a held call by the agent's CLI engine, answered by the person

/** A change the agent asks for over MCP, which Ask first holds at the Gate. */
export const HELD_TASK = (title: string): string => `tool tasks_create ${JSON.stringify({ title, assigned: { kind: "person", id: "usr_olivia" }, idempotencyKey: `rs-${title.replaceAll(" ", "-")}` })}`;

/** Ask a held change, approve it (or decline it), and return what the agent said after: the run of one approval on wherever the chat runs. */
export async function heldThenAnswered(s: SpaceRig, threadId: string, agentId: string, title: string, answer: "approve" | "reject"): Promise<{ held: string; after: string; taskId: string }> {
  const before = await send(s, threadId, agentId, HELD_TASK(title), `rs-held-${title.replaceAll(" ", "-")}`);
  const hold = await waitFor(async () => {
    await s.d.hooks?.pump?.();
    const h = (await s.as(null, "gate.holds.list", { states: ["held"] })).data.holds as Array<{ taskId: string; capName: string }> | undefined;
    return h?.find((x) => x.capName === "tasks.create") ?? null;
  }, 20_000, () => hostLog(s.d));
  const held = await replyAfter(s, threadId, before);
  // the card is in the chat, pointing at the approval
  await waitFor(async () => ((await messages(s, threadId)).some((m) => (m.blocks ?? []).some((b) => b.type === "link_card" && (b.data as { target?: { id?: string } } | undefined)?.target?.id === hold.taskId)) ? true : null), 10_000);
  const mark = (await messages(s, threadId)).length;
  const r = await s.as(null, "tasks.act", { taskId: hold.taskId, action: answer, ...(answer === "reject" ? { note: "Not this one" } : {}) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const after = await replyAfter(s, threadId, mark);
  return { held, after, taskId: hold.taskId };
}

export async function taskTitles(s: SpaceRig): Promise<string[]> {
  return (((await s.as(null, "tasks.list", {})).data.tasks as Array<{ title: string }> | undefined) ?? []).map((t) => t.title);
}
