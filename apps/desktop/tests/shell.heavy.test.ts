// @heavy: the sidecar as the shell runs it. Starts the real vyred device daemon the way sidecar.rs does (the Node runtime on
// host/src/daemon/main.ts, --role device --port 0), reads its "listening on" line, reaches /healthz over a socket, stops it,
// starts it again on the same data directory and checks the person's data is still there. With VYRE_SHELL_APP set (the desktop
// job, on a built app) it also launches the real shell, waits for its "sidecar ready" line, opens a vyre:// link and sees it delivered.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MAIN = path.join(REPO, "host/src/daemon/main.ts");

type Running = { child: ChildProcess; url: string; version: string; out: () => string };

/** The same parse as sidecar.rs: `vyred <version> <roles> <space> listening on <loopback url>`. */
function parseLine(line: string): { url: string; version: string } | null {
  const m = /^vyred (\S+) .*listening on (http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+)\s*$/.exec(line);
  return m ? { version: m[1], url: m[2] } : null;
}

function startSidecar(dataDir: string): Promise<Running> {
  const child = spawn(process.execPath, [MAIN, "--role", "device", "--data-dir", dataDir, "--host", "127.0.0.1", "--port", "0"], { cwd: REPO, env: { ...process.env, VYRE_VERSION: "9.9.9" } });
  let out = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`no listening line in 20 s: ${out}`)); }, 20_000);
    const onData = (chunk: Buffer): void => {
      out += chunk.toString("utf8");
      for (const line of out.split("\n")) {
        const hit = parseLine(line);
        if (hit) { clearTimeout(timer); resolve({ child, ...hit, out: () => out }); return; }
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (c: Buffer) => { out += c.toString("utf8"); });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`sidecar exited ${String(code)}: ${out}`)); });
  });
}

async function stopSidecar(r: Running, dataDir: string): Promise<void> {
  if (r.child.exitCode !== null) return;
  r.child.removeAllListeners("exit");
  const done = new Promise<void>((resolve) => r.child.once("exit", () => resolve()));
  const denied = await fetch(`${r.url}/local/daemon/stop`, { method: "POST" });
  assert.equal(denied.status, 401, "the loopback shutdown endpoint needs the local admin token");
  const token = fs.readFileSync(path.join(dataDir, "admin.token"), "utf8").trim();
  const stopped = await fetch(`${r.url}/local/daemon/stop`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  assert.equal(stopped.status, 202, "the loopback admin endpoint accepts a graceful shutdown");
  try {
    await Promise.race([done, new Promise<void>((_, reject) => setTimeout(() => reject(new Error("authenticated HTTP stop did not let vyred exit naturally")), 5000))]);
  } finally {
    if (r.child.exitCode === null) {
      if (process.platform === "win32" && r.child.pid) spawnSync("taskkill", ["/PID", String(r.child.pid), "/T", "/F"], { stdio: "ignore", timeout: 5000 });
      else r.child.kill("SIGKILL");
    }
  }
}

/** Same check as sidecar.rs: any 200 from /healthz. */
async function healthz(url: string): Promise<{ status: number; body: { roles?: string[]; space?: string | null; version?: string } }> {
  const res = await fetch(`${url}/healthz`);
  return { status: res.status, body: (await res.json()) as { roles?: string[]; space?: string | null; version?: string } };
}

test("the sidecar starts on a free loopback port, answers /healthz and keeps its data across a restart", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-shell-"));
  const data = path.join(dir, "vyred");
  fs.mkdirSync(data, { recursive: true });
  try {
    const first = await startSidecar(data);
    let token = "";
    try {
      assert.equal(first.version, "9.9.9");
      const port = Number(new URL(first.url).port);
      assert.ok(port > 0 && port !== 8420, `a free port was picked (${port})`);
      const h = await healthz(first.url);
      assert.equal(h.status, 200);
      assert.deepEqual(h.body.roles, ["device"]);
      assert.equal(h.body.space ?? null, null);
      token = fs.readFileSync(path.join(data, "admin.token"), "utf8").trim();
      assert.ok(token.length >= 32, "the local admin token was created");
      // POSIX mode bits are not an ACL check on Windows (Node reports synthetic
      // permission bits there); the restart token identity check below remains
      // the cross-platform persistence proof.
      if (process.platform !== "win32") assert.equal(fs.statSync(path.join(data, "admin.token")).mode & 0o077, 0, "owner-only file");
      const info = JSON.parse(fs.readFileSync(path.join(data, "vyred.json"), "utf8")) as { url: string; pid: number };
      assert.equal(info.url, first.url);
      assert.equal(info.pid, first.child.pid);
      fs.writeFileSync(path.join(data, "replica-marker.txt"), "kept");
    } finally {
      await stopSidecar(first, data);
    }
    assert.equal(fs.existsSync(path.join(data, "vyred.json")), false, "a clean stop clears the info file");
    await assert.rejects(fetch(`${first.url}/healthz`), "nothing answers once it is stopped");

    const second = await startSidecar(data);
    try {
      const h = await healthz(second.url);
      assert.equal(h.status, 200);
      assert.equal(fs.readFileSync(path.join(data, "admin.token"), "utf8").trim(), token, "same token after restart: the data directory is the identity");
      assert.equal(fs.readFileSync(path.join(data, "replica-marker.txt"), "utf8"), "kept");
    } finally {
      await stopSidecar(second, data);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a sidecar line from another address is not trusted", () => {
  assert.equal(parseLine("vyred 1.0.0 device - listening on http://10.1.2.3:8420"), null);
  assert.deepEqual(parseLine("vyred 1.0.0 device - listening on http://127.0.0.1:5000"), { version: "1.0.0", url: "http://127.0.0.1:5000" });
});

const APP = process.env["VYRE_SHELL_APP"];
const RELAUNCH = process.env["VYRE_SHELL_RELAUNCH"] === "1";

async function awaitSidecarStop(url: string): Promise<void> {
  const end = Date.now() + 10_000;
  while (Date.now() < end) {
    try {
      const res = await fetch(`${url}/healthz`);
      if (res.status !== 200) return;
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`the packaged sidecar at ${url} stayed live after its app exited`);
}

async function stopBuiltShell(app: ChildProcess, sidecarUrl: string | null, out: string): Promise<void> {
  if (app.exitCode === null) {
    const stopped = new Promise<void>((resolve) => app.once("exit", () => resolve()));
    try {
      if (process.platform === "darwin") {
        const quit = spawnSync("osascript", ["-e", "tell application id \"ai.vyre.desktop\" to quit"], { encoding: "utf8" });
        assert.equal(quit.status, 0, `normal macOS app quit failed: ${quit.stderr}`);
      } else {
        app.kill();
      }
      await Promise.race([stopped, new Promise<void>((_, reject) => setTimeout(() => reject(new Error(`built shell did not exit after normal quit:\n${out.slice(-2000)}`)), 10_000))]);
    } catch (error) {
      app.kill("SIGKILL");
      throw error;
    }
  }
  if (sidecarUrl) await awaitSidecarStop(sidecarUrl);
}

async function exerciseBuiltShell(takeLink: boolean): Promise<void> {
  const app = spawn(APP as string, [], { env: { ...process.env, VYRE_SHELL_BANNER: "1" } });
  let out = "";
  let sidecarUrl: string | null = null;
  app.stdout.on("data", (c: Buffer) => { out += c.toString("utf8"); });
  app.stderr.on("data", (c: Buffer) => { out += c.toString("utf8"); });
  const until = async (re: RegExp, ms: number): Promise<RegExpExecArray> => {
    const end = Date.now() + ms;
    for (;;) {
      const m = re.exec(out);
      if (m) return m;
      if (app.exitCode !== null || app.signalCode !== null) throw new Error(`built shell exited before ${String(re)} (code ${String(app.exitCode)}, signal ${String(app.signalCode)}):\n${out.slice(-2000)}`);
      if (Date.now() > end) throw new Error(`not seen: ${String(re)}\n${out.slice(-2000)}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  };
  try {
    const ready = await until(/vyre-desktop: sidecar ready at (http:\/\/127\.0\.0\.1:\d+)/, 60_000);
    sidecarUrl = ready[1];
    assert.equal((await healthz(sidecarUrl)).status, 200);
    if (takeLink) {
      const opener = process.platform === "darwin" ? ["open"] : process.platform === "win32" ? ["cmd", "/c", "start", ""] : ["xdg-open"];
      const r = spawnSync(opener[0], [...opener.slice(1), "vyre://open?address=acme.example.com"], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      await until(/vyre-desktop: deep link open received/, 20_000);
    }
    const page = await until(/vyre-desktop: page rendered: (\d+) chars at (?:tauri:\/\/localhost|https?:\/\/tauri\.localhost)/, 20_000);
    console.log(`page: ${page[0]}`);
    if (takeLink) assert.doesNotMatch(out, /acme\.example\.com/, "link parameters never reach the log");
    // The desktop job takes its screenshot of the first running window during this hold.
    // The relaunch already proves sidecar health and rendering, so it can exit immediately.
    if (takeLink) await new Promise((r) => setTimeout(r, Number(process.env["VYRE_SHELL_HOLD_MS"] ?? "0")));
  } finally {
    await stopBuiltShell(app, sidecarUrl, out);
  }
}

test("the built shell starts, reaches its sidecar and takes a vyre:// link", { skip: !APP && "VYRE_SHELL_APP is set only in the desktop job on a built app" }, async () => {
  await exerciseBuiltShell(true);
});

test("the installed shell relaunches after a clean exit", { skip: !APP ? "VYRE_SHELL_APP is set only in the desktop job on a built app" : !RELAUNCH && "VYRE_SHELL_RELAUNCH enables the installed-app proof" }, async () => {
  await exerciseBuiltShell(false);
});

// Final run on the last commit of P-L10_03: the app test above runs in the desktop job (VYRE_SHELL_APP); this file reports its own ok line.
