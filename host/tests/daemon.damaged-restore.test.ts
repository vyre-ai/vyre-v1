// A Space that held on a damaged database (daemon.damaged-db.test.ts, daemon.damaged-events.test.ts) starts as usual once a restore has put a sound file back: the start checks the
// marked file once, finds it sound, removes the marker and goes on. Split from the hold tests so each file stays well under the fast runner's 30 s cap.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { holdMarker, markDamaged } from "../src/daemon/damaged-db.ts";
import { STOP_BOUND_MS, reportArgs, watchStop } from "./stop-watch-kit.test.ts";

const MAIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "daemon", "main.ts");

async function startUntilListening(
  dir: string,
): Promise<{ out: string; err: string; stopMs: number; evidence: string }> {
  const reports = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-stop-report-"));
  const child = spawn(
    process.execPath,
    [
      ...reportArgs(reports),
      "--experimental-strip-types",
      MAIN,
      "--role",
      "space",
      "--data-dir",
      dir,
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--space",
      "spc_damaged0002",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const watch = watchStop(child, dir, reports);
  let out = "",
    err = "";
  child.stderr.on("data", (c: Buffer) => {
    err += c.toString("utf8");
  });
  // SIGTERM once it listens; the stop it starts is measured, never cut short
  child.stdout.on("data", (c: Buffer) => {
    out += c.toString("utf8");
    if (out.includes("listening on")) watch.term();
  });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      const ev = watch.evidence();
      child.kill("SIGKILL");
      reject(new Error(`still running after 90 s\nstderr: ${err}\nstdout: ${out}\n${ev}`));
    }, 90_000);
    child.once("exit", () => {
      clearTimeout(t);
      resolve();
    });
  });
  return { out, err, stopMs: watch.stopMs() ?? -1, evidence: watch.evidence() };
}

test(
  "a marked database that a restore made sound again: the next start checks it once, removes the marker and starts as usual",
  { timeout: 120_000 },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-damaged-restore-"));
    try {
      // the sound file a restore put back, written directly (a sound SQLite file with a table and rows; booting a Space first to make one doubled this file's time), and the
      // marker the start that met the damaged one left behind
      const sound = new DatabaseSync(path.join(dir, "modules.db"));
      sound.exec("CREATE TABLE restored(v TEXT); INSERT INTO restored VALUES ('from the backup')");
      sound.close();
      markDamaged(dir, "modules.db", "database disk image is malformed");
      assert.ok(fs.existsSync(holdMarker(dir)));
      const again = await startUntilListening(dir);
      assert.match(again.out, /listening on/, `it starts, it does not hold: ${again.err}`);
      assert.ok(again.stopMs <= STOP_BOUND_MS, `the stop after SIGTERM took ${again.stopMs} ms\n${again.evidence}`);
      assert.doesNotMatch(again.err, /is damaged/);
      assert.equal(fs.existsSync(holdMarker(dir)), false, "the marker is gone");
      const kept = new DatabaseSync(path.join(dir, "modules.db"), { readOnly: true });
      assert.equal(
        (kept.prepare("SELECT v FROM restored").get() as { v: string }).v,
        "from the backup",
        "the restored file is the one the Space runs on",
      );
      kept.close();
    } finally {
      fs.rmSync(holdMarker(dir), { force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
