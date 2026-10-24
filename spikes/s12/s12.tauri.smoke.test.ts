// S12: Tauri shell contract, encrypted OPFS replica across a process restart, vyred reachable.
// Run on CI: node --test spikes/s12/s12.tauri.smoke.test.ts
// @reads ./README.md
// @reads ./REPORT.md
// @reads ./web/index.html
// @reads ./src-tauri/Cargo.toml
// @reads ./src-tauri/tauri.conf.json
// @reads ./src-tauri/build.rs
// @reads ./src-tauri/capabilities/default.json
// @reads ./src-tauri/src/main.rs
// @reads ./src-tauri/src/lib.rs
// @reads ./src-tauri/binaries/vyred.py
// @reads ./src-tauri/binaries/vyred-aarch64-apple-darwin
// @reads ./src-tauri/binaries/vyred-x86_64-apple-darwin
// @reads ./src-tauri/binaries/vyred-x86_64-unknown-linux-gnu
// @reads ./src-tauri/binaries/vyred-aarch64-unknown-linux-gnu
// @reads ./mac/Shell.swift
// @reads ./mac/Info.plist
// @reads ./mac/build-adhoc.sh
// @reads ./proof/codesign.txt
// @reads ./proof/mac-adhoc-connected.png

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { Replica, replicaKey } from "./replica.ts";
import { healthBody } from "./sidecar.ts";
import { reachSidecar, reachWeb } from "./reach.ts";
import { SPIKE_ROOT, loadShell } from "./shell.ts";

const MARK = "SECRET-REPLICA-s12";
const metric = (name: string, obj: object) => console.log("METRIC " + JSON.stringify({ name, ...obj }));

function pngSize(buf: Buffer): { w: number; h: number } {
  assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(buf.subarray(12, 16).toString("ascii"), "IHDR");
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function runFile(script: string, args: string[], env: Record<string, string>): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, ...env } });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 8000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stderr });
    });
  });
}

async function waitForPort(file: string, child: ChildProcess, stderr: () => string): Promise<number> {
  const start = Date.now();
  while (Date.now() - start < 5000) {
    if (child.exitCode !== null) throw new Error(`sidecar exited ${child.exitCode}: ${stderr()}`);
    if (fs.existsSync(file)) {
      const port = Number(fs.readFileSync(file, "utf8").trim());
      if (port > 0) return port;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`sidecar silent: ${stderr()}`);
}

test("encrypted replica persists across a process restart", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s12-replica-"));
  const key = replicaKey(crypto.randomBytes(32), "space1", "dev1");
  const id = "row1";
  const replica = Replica.open(dir, key);
  replica.put(id, MARK);
  assert.equal(replica.atRest().includes(Buffer.from(MARK)), false);
  replica.close();

  const reopened = Replica.open(dir, key);
  assert.equal(reopened.get(id), MARK);
  reopened.close();

  const entry = path.join(SPIKE_ROOT, "replica.ts");
  const out = path.join(dir, "out.txt");
  const ok = await runFile(entry, ["--reopen"], {
    S12_DIR: dir,
    S12_KEY: key.toString("hex"),
    S12_ID: id,
    S12_OUT: out,
  });
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(fs.readFileSync(out, "utf8"), `OK ${MARK}`);

  const badOut = path.join(dir, "bad.txt");
  const bad = await runFile(entry, ["--reopen"], {
    S12_DIR: dir,
    S12_KEY: crypto.randomBytes(32).toString("hex"),
    S12_ID: id,
    S12_OUT: badOut,
  });
  assert.equal(bad.code, 0, bad.stderr);
  assert.equal(fs.readFileSync(badOut, "utf8"), "REJECTED");
  metric("s12.replica_restart", { ok: true });
});

test("sidecar starts and the UI client reaches vyred", async () => {
  assert.equal(healthBody().name, "vyred");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "s12-side-"));
  const portFile = path.join(scratch, "port");
  let stderr = "";
  const child = spawn(process.execPath, [path.join(SPIKE_ROOT, "sidecar.ts"), "--serve"], {
    env: {
      ...process.env,
      VYRE_SIDECAR_PORT: "0",
      VYRE_WEB: path.join(SPIKE_ROOT, "web"),
      VYRE_PORT_FILE: portFile,
    },
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  try {
    const port = await waitForPort(portFile, child, () => stderr);
    const base = `http://127.0.0.1:${port}`;
    const health = await reachSidecar(base);
    assert.equal(health.ok, true);
    assert.equal(health.name, "vyred");
    assert.equal(health.pid, child.pid);
    const html = await reachWeb(base);
    assert.match(html, /id="sidecar"/);
    assert.match(html, /navigator\.storage\.getDirectory/);
    assert.match(html, /127\.0\.0\.1:47211\/health/);
    metric("s12.sidecar_reach", { ok: true, pid: health.pid });
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve(undefined);
        }, 1000);
        child.once("close", () => {
          clearTimeout(timer);
          resolve(undefined);
        });
      });
    }
  }
});

test("tauri shell loads the web build, deep link, shortcut, sidecar, mac and win targets", () => {
  const shell = loadShell();
  assert.equal(shell.productName, "Vyre");
  assert.equal(shell.frontendDist, "../web");
  assert.equal(shell.signingIdentity, "-");
  assert.ok(shell.targets.includes("app"));
  assert.ok(shell.targets.includes("nsis"));
  assert.ok(shell.targets.includes("deb"));
  assert.ok(shell.targets.includes("appimage"));
  assert.deepEqual(shell.schemes, ["vyre"]);
  assert.ok(shell.externalBin.includes("binaries/vyred"));
  assert.equal(shell.deepLink, true);
  assert.equal(shell.shortcut, true);
  assert.equal(shell.sidecar, true);

  const html = fs.readFileSync(path.join(SPIKE_ROOT, "web/index.html"), "utf8");
  assert.match(html, /vyre:\/\//);
  assert.match(html, /CommandOrControl\+Shift\+V/);
  assert.match(html, /AES-GCM/);

  const py = fs.readFileSync(path.join(SPIKE_ROOT, "src-tauri/binaries/vyred.py"), "utf8");
  assert.match(py, /"vyred"/);
  assert.match(py, /\/health/);
  for (const triple of [
    "vyred-aarch64-apple-darwin",
    "vyred-x86_64-apple-darwin",
    "vyred-x86_64-unknown-linux-gnu",
    "vyred-aarch64-unknown-linux-gnu",
  ]) {
    const file = path.join(SPIKE_ROOT, "src-tauri/binaries", triple);
    assert.equal(fs.readFileSync(file, "utf8"), py);
  }

  const plist = fs.readFileSync(path.join(SPIKE_ROOT, "mac/Info.plist"), "utf8");
  assert.match(plist, /<string>vyre<\/string>/);
  const sign = fs.readFileSync(path.join(SPIKE_ROOT, "proof/codesign.txt"), "utf8");
  assert.match(sign, /Signature=adhoc/);
  assert.match(sign, /ai\.vyre\.desktop\.s12/);
  const png = fs.readFileSync(path.join(SPIKE_ROOT, "proof/mac-adhoc-connected.png"));
  const size = pngSize(png);
  assert.ok(size.w >= 400 && size.h >= 300, `${size.w}x${size.h}`);
  metric("s12.shell", { ok: true, png: `${size.w}x${size.h}` });
});
