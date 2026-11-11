// Shared parts of the agent Computer live tests (host/tests/computers.*.live.test.ts): a booted daemon on a seeded data dir, the image, Docker and gateway calls, and the Files home helpers.
// Not a test file. The five tests split the one lifecycle test this replaced (computers.live.test.ts) by behaviour so each runs in a job of its own.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../src/daemon/daemon.ts";


export const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
export const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));

export const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
export const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (the computer is a real container)";
export const IMAGE = `vyre/agent-computer:live-${process.pid}${Math.random().toString(36).slice(2, 6)}`;

export function seededDir(): string {
  const core = bootCore();
  const dir = tmp("vyre-computers-live-");
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

export function docker(args: string[], timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile("docker", args, { cwd: CODE_ROOT, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as NodeJS.ErrnoException & { code?: number }).code as number | undefined) ?? 1 : 0, out: `${stdout}\n${stderr}` });
    });
  });
}

export async function boot(dir: string): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({
      os: "linux", hostname: "computers-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    computersHomeIntervalMs: 20_000,
    // room is the test's own: a shared runner's free memory and the other jobs on it must not decide whether this computer starts
    computersCapacity: { totalMb: 65_536, freeMb: 60_000, cpus: 8, os: "linux", diskFreeMb: 200_000 },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
}

export async function call(d: Daemon, cap: string, input: unknown, token: string = d.token): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(input) });
  const body = (await r.json().catch(() => ({}))) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}

/** The image for this process: a prebuilt one named by VYRE_AGENT_COMPUTER_TEST_IMAGE, or one built from this checkout. */
export async function ensureImage(): Promise<void> {
  // VYRE_AGENT_COMPUTER_TEST_IMAGE names an image already built from this checkout (a box that has one need not build it again); otherwise it is built here
  const prebuilt = process.env["VYRE_AGENT_COMPUTER_TEST_IMAGE"];
  if (prebuilt === undefined) {
    // Vyre for Chrome ships in the image (owner rule): the extension is copied into a copy of the build context, as the release build does (the runners have no buildx)
    const ctxDir = tmp("vyre-agentcomp-ctx-");
    fs.cpSync(path.join(CODE_ROOT, "images/agent-computer"), ctxDir, { recursive: true });
    fs.cpSync(path.join(CODE_ROOT, "apps/chrome/manifest.json"), path.join(ctxDir, "vyre-chrome/manifest.json"));
    fs.cpSync(path.join(CODE_ROOT, "apps/chrome/src"), path.join(ctxDir, "vyre-chrome/src"), { recursive: true });
    const built = await docker(["build", "-t", IMAGE, ctxDir], 1_200_000);
    fs.rmSync(ctxDir, { recursive: true, force: true });
    assert.equal(built.code, 0, `building ${IMAGE} failed: ${built.out.slice(-1500)}`);
  }
  process.env["VYRE_AGENT_COMPUTER_IMAGE"] = prebuilt ?? IMAGE;
}

/** What every test ends with: the computer removed if still there, the daemon stopped, the image the test built removed. */
export async function finish(d: Daemon, computerId: string): Promise<void> {
  if (computerId) await call(d, "computers.remove", { computerId }).catch(() => undefined);
  await d.stop();
  delete process.env["VYRE_AGENT_COMPUTER_IMAGE"];
  await docker(["image", "rm", "-f", IMAGE], 60_000);
}

/** An agent with a computer, woken (the same calls and checks the lifecycle test makes first). */
export async function wakeComputer(d: Daemon): Promise<{ agentId: string; computerId: string; box: string }> {
    const made = await call(d, "agents.create", { name: "Desk", role: "You work at a computer.", idempotencyKey: "computers-live-agent" });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    const agentId = made.data.agent.agentId as string;

  const prov = await call(d, "computers.provision", { agentId, idempotencyKey: "computers-live-provision" });
  assert.equal(prov.status, 200, JSON.stringify(prov.data));
  const computerId = prov.data.computer.computerId as string;
  assert.equal(prov.data.computer.state, "asleep", "a computer is asleep until someone presses it");
  const woke = await call(d, "computers.wake", { computerId });
  assert.equal(woke.status, 200, JSON.stringify(woke.data));
  assert.equal(woke.data.computer.state, "working");
  return { agentId, computerId, box: `vyre-comp-${computerId.replace(/^cmt_/, "")}` };
}

/** The agent's home in Files, mirrored onto the computer (P-L2_35): the helpers the home and the download tests share. */
export function homeKit(d: Daemon, dir: string, agentId: string, box: string, folderId: string) {
    const HOME = "/home/agent/Vyre";
    const inBox = (sh: string) => docker(["exec", "-u", "10001", box, "sh", "-c", sh], 30_000);
    // what the mirror and the computer look like, for a failure message: the daemon's computers log, the home as the container sees it and as the host has it, the mounts, and Files' own listing
    const diag = async (): Promise<string> => {
      d.sink.flush();
      const logs = d.sink.db.prepare("SELECT msg, attrs FROM logs WHERE place = 'computers' ORDER BY at DESC LIMIT 12").all();
      const ls = await inBox(`ls -laR ${HOME} | head -40`);
      const mounts = await docker(["inspect", box, "--format", "{{json .Mounts}}"], 30_000);
      const hostHome = path.join(dir, "computers", agentId, "Vyre");
      const listed = await call(d, "files.list", { folder: folderId, limit: 50 });
      return JSON.stringify({ logs, ls: ls.out, mounts: mounts.out.slice(0, 600), host: fs.existsSync(hostHome) ? fs.readdirSync(hostHome) : "missing", files: listed.data }).slice(0, 4000);
    };
    const until = async <T>(what: string, f: () => Promise<T | null | undefined | false>, ms = 45_000): Promise<T> => {
      for (const end = Date.now() + ms; Date.now() < end; await new Promise<void>((r) => setTimeout(r, 750))) { const v = await f(); if (v) return v as T; }
      throw new Error(`never happened: ${what}. ${await diag()}`);
    };
    const filesIn = async (folder: string) => (await call(d, "files.list", { folder, limit: 200 })).data as { files: Array<{ fileId: string; name: string; version: number }>; folders: Array<{ folderId: string; name: string }> };
    const textOf = async (fileId: string) => (await call(d, "files.read", { fileId, as: "text" })).data.text as string;
    const onDisk = async (rel: string) => { const r = await inBox(`cat ${HOME}/${rel}`); return r.code === 0 ? r.out : null; };

    // "Nothing happened" cannot be waited for, so it is proven by two control files: one written on the computer after the fixture, one after the first has reached Files. Each reaching Files means a whole
    // mirror pass ran after the fixture was in place, and the second means a pass that began after the first was done; a symlink or an escaping link would have been acted on in those passes.
    const passes = async (tag: string): Promise<void> => {
      for (const n of [1, 2]) {
        await inBox(`printf ${tag}-${n} > ${HOME}/ctl-${tag}-${n}.txt`);
        await until(`control file ctl-${tag}-${n}.txt in Files`, async () => (await filesIn(folderId)).files.find((f) => f.name === `ctl-${tag}-${n}.txt`));
      }
    };

  return { HOME, inBox, diag, until, filesIn, textOf, onDisk, passes };
}
