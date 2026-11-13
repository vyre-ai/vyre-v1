// The whole damaged-database cycle on one Space, end to end, as a server meets it (the parts are in daemon.damaged-db.test.ts, daemon.damaged-events.test.ts and
// daemon.damaged-restore.test.ts, split there for the fast runner's 30 s cap): a working Space; modules.db damaged; the start that meets it names it and exits 3; the restart
// holds (up, 503 with the line on every request, nothing in the data folder touched); a restore puts the good file back; the next start serves as usual. Every stop after
// SIGTERM ends within the documented bound and is never cut short. Heavy by name: it runs in its own slow job, and heavy.yml's install-heavy job runs it too.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { holdMarker } from "../src/daemon/damaged-db.ts";
import { STOP_BOUND_MS, reportArgs, watchStop } from "./stop-watch-kit.test.ts";

const MAIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "daemon", "main.ts");

async function freePort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  const p = (s.address() as net.AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return p;
}

function start(dir: string, port: number, untilListening: boolean) {
  const reports = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-cycle-report-"));
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
      String(port),
      "--space",
      "spc_dmgcycle001",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const watch = watchStop(child, dir, reports);
  let out = "",
    err = "";
  child.stderr.on("data", (c: Buffer) => {
    err += c.toString("utf8");
  });
  child.stdout.on("data", (c: Buffer) => {
    out += c.toString("utf8");
    if (untilListening && out.includes("listening on")) watch.term();
  });
  const code = new Promise<number | null>((resolve, reject) => {
    const t = setTimeout(() => {
      const ev = watch.evidence();
      child.kill("SIGKILL");
      reject(new Error(`still running after 90 s\nstderr: ${err}\nstdout: ${out}\n${ev}`));
    }, 90_000);
    child.once("exit", (c) => {
      clearTimeout(t);
      resolve(c);
    });
  });
  return { code, out: () => out, err: () => err, watch };
}
const sum = (dir: string): string =>
  fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".db"))
    .sort()
    .map(
      (n) =>
        `${n}:${createHash("sha256")
          .update(fs.readFileSync(path.join(dir, n)))
          .digest("hex")}`,
    )
    .join("\n");

test(
  "@heavy a damaged modules.db, end to end: named and exit 3, then a hold answering 503 with the line, then a restore and a normal start; every stop within its bound",
  { timeout: 300_000 },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-dmgcycle-"));
    const port = await freePort();
    try {
      const first = start(dir, port, true);
      await first.code;
      assert.match(first.out(), /listening on/, first.err());
      assert.ok(first.watch.stopMs()! <= STOP_BOUND_MS, `stop ${first.watch.stopMs()} ms\n${first.watch.evidence()}`);
      const file = path.join(dir, "modules.db");
      const good = fs.readFileSync(file);
      const b = Buffer.from(good);
      const page = b.readUInt16BE(16) === 1 ? 65536 : b.readUInt16BE(16);
      for (let i = page; i < b.length; i++) b[i] = (i * 37) & 0xff;
      fs.writeFileSync(file, b);
      for (const e of ["-wal", "-shm"]) fs.rmSync(file + e, { force: true });
      const fail = start(dir, port, false);
      assert.equal(await fail.code, 3, fail.err());
      assert.match(
        fail.err(),
        /^vyred: modules\.db is damaged \(database disk image is malformed\), so the Space cannot start\..*vyre-server restore <backup file> --yes/m,
      );
      const before = sum(dir);
      const held = start(dir, port, false);
      let res: Response | undefined;
      for (let i = 0; i < 200 && !res; i++) {
        try {
          res = await fetch(`http://127.0.0.1:${port}/healthz`);
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      assert.ok(res, held.err());
      assert.equal(res.status, 503);
      const body = (await res.json()) as { error: { code: string; message: string } };
      assert.equal(body.error.code, "space.damaged");
      assert.match(body.error.message, /^modules\.db is damaged/);
      held.watch.term();
      assert.equal(await held.code, 0);
      assert.ok(held.watch.stopMs()! <= STOP_BOUND_MS, `stop ${held.watch.stopMs()} ms\n${held.watch.evidence()}`);
      assert.equal(sum(dir), before, "the hold changed no database");
      // the restore: the good file back (vyre-server restore puts the whole folder back; the file is what matters to the daemon)
      fs.writeFileSync(file, good);
      const again = start(dir, port, true);
      await again.code;
      assert.match(again.out(), /listening on/, `serves as usual after the restore: ${again.err()}`);
      assert.doesNotMatch(again.err(), /is damaged/);
      assert.ok(again.watch.stopMs()! <= STOP_BOUND_MS, `stop ${again.watch.stopMs()} ms\n${again.watch.evidence()}`);
      assert.equal(fs.existsSync(holdMarker(dir)), false);
    } finally {
      fs.rmSync(holdMarker(dir), { force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
