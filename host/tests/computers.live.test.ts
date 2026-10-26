// @heavy docker
// An agent's computer on a booted daemon (P-L2_25, spec 2.7): nothing is bound by the test. The daemon wires the computers seam itself (host/src/seams/computers.ts), the module builds its Docker
// host from it, and the calls go the way a person makes them: HTTP with a bearer token through the gateway. An agent is created, given a computer (asleep until pressed), woken, shows a real
// screen picture from the agentd in the image, and is put to sleep. A caller without the token is refused. The image is built from images/agent-computer under a tag of this run.
// Runs only with VYRE_HEAVY_DOCKER=1 (the l2-heavy job).
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
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (the computer is a real container)";
const IMAGE = `vyre/agent-computer:live-${process.pid}${Math.random().toString(36).slice(2, 6)}`;

function seededDir(): string {
  const core = bootCore();
  const dir = tmp("vyre-computers-live-");
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

function docker(args: string[], timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile("docker", args, { cwd: CODE_ROOT, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as NodeJS.ErrnoException & { code?: number }).code as number | undefined) ?? 1 : 0, out: `${stdout}\n${stderr}` });
    });
  });
}

async function boot(dir: string): Promise<Daemon> {
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
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
}

async function call(d: Daemon, cap: string, input: unknown, token: string = d.token): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(input) });
  const body = (await r.json().catch(() => ({}))) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}

test("computers live: an agent's computer on a booted daemon is asleep until woken, shows a screen frame, and sleeps again", { skip }, async () => {
  const built = await docker(["build", "-t", IMAGE, "images/agent-computer"], 1_200_000);
  assert.equal(built.code, 0, `building ${IMAGE} failed: ${built.out.slice(-1500)}`);
  process.env["VYRE_AGENT_COMPUTER_IMAGE"] = IMAGE;
  const dir = seededDir();
  const d = await boot(dir);
  let computerId = "";
  try {
    assert.deepEqual(d.seams?.missing, [], "no live module is left without its driver");
    assert.ok(d.seams?.wired.includes("setComputerHost"), "the computers seam is wired");

    // a caller without the token is refused, whatever the computer is
    const refused = await call(d, "computers.list", {}, "not-a-token");
    assert.ok(refused.status === 401 || refused.status === 403, `refused without a valid token, got ${refused.status}`);

    const made = await call(d, "agents.create", { name: "Desk", role: "You work at a computer.", idempotencyKey: "computers-live-agent" });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    const agentId = made.data.agent.agentId as string;

    const health = await call(d, "computers.health", {});
    assert.equal(health.status, 200, JSON.stringify(health.data));

    const prov = await call(d, "computers.provision", { agentId, idempotencyKey: "computers-live-provision" });
    assert.equal(prov.status, 200, JSON.stringify(prov.data));
    computerId = prov.data.computer.computerId as string;
    assert.equal(prov.data.computer.state, "asleep", "a computer is asleep until someone presses it");

    const woke = await call(d, "computers.wake", { computerId });
    assert.equal(woke.status, 200, JSON.stringify(woke.data));
    assert.equal(woke.data.computer.state, "working");

    const shot = await call(d, "computers.screenshot", { computerId });
    assert.equal(shot.status, 200, JSON.stringify(shot.data));
    assert.ok(typeof shot.data.fileId === "string" && shot.data.fileId.length > 0, "the picture is stored as a file");
    assert.ok(shot.data.width > 0 && shot.data.height > 0, `a real frame: ${shot.data.width}x${shot.data.height}`);

    // the profile disk at rest (P-L2_33): a marker in the browser profile is not on the volume or in the sealed file while the computer sleeps, and comes back at wake
    const MARKER = "PROFILE-MARKER-4f9a21";
    const put = await docker(["exec", "-u", "10001", box, "sh", "-c", `printf ${MARKER} > /home/agent/.profile-disk/marker.txt`], 30_000);
    assert.equal(put.code, 0, `the marker was written into the profile: ${put.out}`);

    const slept = await call(d, "computers.sleep", { computerId });
    assert.equal(slept.status, 200, JSON.stringify(slept.data));
    assert.equal(slept.data.computer.state, "asleep");
    const left = await docker(["run", "--rm", "--network", "none", "--entrypoint", "find", "-v", `${box}-profile:/p:ro`, IMAGE, "/p", "-mindepth", "1"], 120_000);
    assert.equal(left.out.trim(), "", `the profile volume is empty while the computer sleeps: ${left.out}`);
    const sealedFile = path.join(dir, "computers", ".sealed", `${computerId}.profile`);
    const blob = fs.readFileSync(sealedFile);
    assert.ok(blob.length > 0, "the sealed profile is on disk");
    assert.ok(!blob.includes(MARKER) && !blob.includes("marker.txt"), "the sealed profile holds no plaintext of the profile");
    assert.equal(fs.statSync(path.join(dir, "computers-profile.key")).mode & 0o077, 0, "the node key is private to the daemon's user");
    assert.equal(fs.statSync(sealedFile).mode & 0o077, 0, "the sealed profile is private to the daemon's user");

    const again = await call(d, "computers.wake", { computerId });
    assert.equal(again.status, 200, JSON.stringify(again.data));
    const back = await docker(["exec", "-u", "10001", box, "cat", "/home/agent/.profile-disk/marker.txt"], 30_000);
    assert.equal(back.out.trim(), MARKER, "wake puts the profile back");
    const slept2 = await call(d, "computers.sleep", { computerId });
    assert.equal(slept2.status, 200, JSON.stringify(slept2.data));
  } finally {
    if (computerId) await call(d, "computers.remove", { computerId }).catch(() => undefined);
    await d.stop();
    delete process.env["VYRE_AGENT_COMPUTER_IMAGE"];
    await docker(["image", "rm", "-f", IMAGE], 60_000);
  }
});
