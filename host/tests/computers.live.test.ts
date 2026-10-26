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
  // Vyre for Chrome ships in the image (owner rule): the extension is copied into a copy of the build context, as the release build does (the runners have no buildx)
  const ctxDir = tmp("vyre-agentcomp-ctx-");
  fs.cpSync(path.join(CODE_ROOT, "images/agent-computer"), ctxDir, { recursive: true });
  fs.cpSync(path.join(CODE_ROOT, "apps/chrome/manifest.json"), path.join(ctxDir, "vyre-chrome/manifest.json"));
  fs.cpSync(path.join(CODE_ROOT, "apps/chrome/src"), path.join(ctxDir, "vyre-chrome/src"), { recursive: true });
  const built = await docker(["build", "-t", IMAGE, ctxDir], 1_200_000);
  fs.rmSync(ctxDir, { recursive: true, force: true });
  assert.equal(built.code, 0, `building ${IMAGE} failed: ${built.out.slice(-1500)}`);
  process.env["VYRE_AGENT_COMPUTER_IMAGE"] = IMAGE;
  const dir = seededDir();
  let d = await boot(dir);
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

    // the desktop around the browser: the window manager and the dock run, and the dock holds Chrome, Terminal and Files and nothing else
    const box = `vyre-comp-${computerId.replace(/^cmt_/, "")}`;
    let procs = "";
    for (let i = 0; i < 40 && !(/openbox/.test(procs) && /tint2/.test(procs)); i++) {
      procs = (await docker(["exec", box, "ps", "-eo", "comm"], 30_000)).out;
      if (!(/openbox/.test(procs) && /tint2/.test(procs))) await new Promise<void>((r) => setTimeout(r, 500));
    }
    assert.match(procs, /openbox/, `the window manager runs: ${procs}`);
    assert.match(procs, /tint2/, `the dock runs: ${procs}`);
    const rc = (await docker(["exec", box, "cat", "/home/agent/.config/vyre-desktop/tint2rc"], 30_000)).out;
    assert.deepEqual([...rc.matchAll(/launcher_item_app = .*\/(\w+)\.desktop/g)].map((m) => m[1]), ["chrome", "terminal", "files"], "the dock is Chrome, Terminal and Files only");
    const files = (await docker(["exec", box, "cat", "/home/agent/.config/vyre-desktop/files.desktop"], 30_000)).out;
    assert.match(files, /pcmanfm .*\/home\/agent\/Vyre/, "Files opens the agent's own Vyre Files folder");
    // Chromium runs sandboxed: no --no-sandbox flag, and its child processes live in their own user namespace (the sandbox is active, not just allowed)
    const args = (await docker(["exec", box, "ps", "-eo", "args"], 30_000)).out;
    const chromium = args.split("\n").filter((l) => /chromium/.test(l));
    assert.ok(chromium.length > 0, "Chromium runs");
    assert.ok(!chromium.some((l) => /--no-sandbox/.test(l)), `Chromium has no --no-sandbox flag: ${chromium.slice(0, 2).join(" | ")}`);
    const ns = (await docker(["exec", box, "sh", "-c", "own=$(readlink /proc/1/ns/user); n=0; for p in $(pgrep -f -- --type=); do l=$(readlink /proc/$p/ns/user 2>/dev/null); [ -n \"$l\" ] && [ \"$l\" != \"$own\" ] && n=$((n+1)); done; echo sandboxed=$n"], 30_000)).out;
    const inNs = Number(/sandboxed=(\d+)/.exec(ns)?.[1] ?? "0");
    assert.ok(inNs > 0, `Chromium's child processes run in their own user namespace: ${ns}`);
    // Vyre for Chrome is loaded (its service worker runs) and pinned to the toolbar by policy
    const status = await docker(["exec", "-u", "10001", box, "/opt/agentd/ctl", "status", "{}"], 30_000);
    const ext = (JSON.parse(status.out.trim().split("\n").find((l) => l.startsWith("{")) ?? "{}") as { extension?: { configured?: boolean; workers?: number } }).extension;
    assert.equal(ext?.configured, true, `the extension is in the image: ${status.out}`);
    assert.ok((ext?.workers ?? 0) >= 1, `the extension's worker runs: ${status.out}`);
    const policy = (await docker(["exec", box, "cat", "/etc/chromium/policies/managed/vyre.json"], 30_000)).out;
    assert.match(policy, /"toolbar_pin":"force_pinned"/, "the extension is pinned to the toolbar");
    assert.match(policy, /"BrowserSignin":0/, "the browser never offers to sign in");
    assert.match(policy, /"SyncDisabled":true/, "the browser never syncs");
    // a real frame of the desktop, kept for the lead to look at (the wallpaper, the browser and the dock)
    const shotDir = process.env["VYRE_SHOT_DIR"];
    if (shotDir) {
      await new Promise<void>((r) => setTimeout(r, 3_000));
      const frame = await docker(["exec", "-u", "10001", box, "/opt/agentd/ctl", "screenshot", "{}"], 60_000);
      const png = (JSON.parse(frame.out.trim().split("\n").find((l) => l.startsWith("{")) ?? "{}") as { png?: string }).png;
      assert.ok(png, "agentd answered a picture");
      fs.mkdirSync(shotDir, { recursive: true });
      fs.writeFileSync(path.join(shotDir, "P-L2_31-computer-desktop.png"), Buffer.from(png!, "base64"));
    }

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

    // a changed sealed file does not open: the wake fails with a clear reason and the container is never started with a half profile
    const original = fs.readFileSync(sealedFile, "utf8");
    const mid = Math.floor(original.length / 2);
    const flipped = original.slice(0, mid) + (original[mid] === "A" ? "B" : "A") + original.slice(mid + 1);
    fs.writeFileSync(sealedFile, flipped, { mode: 0o600 });
    const tampered = await call(d, "computers.wake", { computerId });
    assert.notEqual(tampered.status, 200, "a wake over a changed sealed profile is refused");
    const failed = await call(d, "computers.get", { computerId });
    assert.equal(failed.data.computer.state, "error");
    assert.match(String(failed.data.computer.error), /sealed profile did not open/, "the reason is readable");
    assert.equal((await docker(["ps", "-q", "--filter", `name=${box}`], 30_000)).out.trim(), "", "no container was started");
    fs.writeFileSync(sealedFile, original, { mode: 0o600 });

    const again = await call(d, "computers.wake", { computerId });
    assert.equal(again.status, 200, JSON.stringify(again.data));
    const back = await docker(["exec", "-u", "10001", box, "cat", "/home/agent/.profile-disk/marker.txt"], 30_000);
    assert.equal(back.out.trim(), MARKER, "wake puts the profile back");
    // a crash between unseal and sleep: the container dies with the plaintext profile on the volume, and the next boot of the daemon seals it
    assert.equal((await docker(["kill", box], 30_000)).code, 0, "the computer is killed");
    const before = fs.statSync(sealedFile).mtimeMs;
    await d.stop();
    d = await boot(dir);
    let emptied = false;
    for (let i = 0; i < 60 && !emptied; i++) {
      emptied = (await docker(["run", "--rm", "--network", "none", "--entrypoint", "find", "-v", `${box}-profile:/p:ro`, IMAGE, "/p", "-mindepth", "1"], 120_000)).out.trim() === "";
      if (!emptied) await new Promise<void>((r) => setTimeout(r, 1_000));
    }
    assert.ok(emptied, "the boot sealed what the crash left on the volume");
    assert.ok(fs.statSync(sealedFile).mtimeMs > before, "the sealed profile was rewritten with the newest state");
    assert.ok(!fs.readFileSync(sealedFile).includes(MARKER), "and holds no plaintext");
  } finally {
    if (computerId) await call(d, "computers.remove", { computerId }).catch(() => undefined);
    await d.stop();
    delete process.env["VYRE_AGENT_COMPUTER_IMAGE"];
    await docker(["image", "rm", "-f", IMAGE], 60_000);
  }
});
