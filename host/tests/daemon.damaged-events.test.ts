// A Space server whose modules.db or events.db is damaged (12 Nov 2026: a Mac mini, after an update's backup read them from the wrong kernel) used to crash-loop under Docker's restart policy
// printing only "vyred: database disk image is malformed" each time: nothing said which file, or that a backup puts it right, and every restart re-opened the damaged file.
// Now: the start that meets it names the file and the restore command in one line and exits 3; the next start checks that one file once and HOLDS: it stays up, opens nothing else, writes
// nothing, and answers every request (/healthz included) 503 with the line, so an update rolls back, doctor says why, and the restart policy has nothing to loop on. A restored good file
// lets the next start go on as usual. Nothing is repaired (logs.db alone is set aside and made anew, by openLogSink).
// One database per file (this one: events.db; daemon.damaged-db.test.ts: modules.db), so each file stays well under the fast runner's 30 s cap.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { holdMarker } from "../src/daemon/damaged-db.ts";
import { STOP_BOUND_MS, reportArgs, watchStop } from "./stop-watch-kit.test.ts";

const MAIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "daemon", "main.ts");
const args = (dir: string, port: number): string[] => ["--experimental-strip-types", MAIN, "--role", "space", "--data-dir", dir, "--host", "127.0.0.1", "--port", String(port), "--space", "spc_damaged0001"];

async function freePort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  const p = (s.address() as net.AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return p;
}

type Run = { code: Promise<number | null>; err: () => string; out: () => string; term: () => void; stopMs: () => number | null; evidence: () => string };
function start(dir: string, port: number, untilListening = false): Run {
  const reports = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-stop-report-"));
  const child = spawn(process.execPath, [...reportArgs(reports), ...args(dir, port)], { stdio: ["ignore", "pipe", "pipe"] });
  const watch = watchStop(child, dir, reports);
  let err = "", out = "";
  child.stderr.on("data", (c: Buffer) => { err += c.toString("utf8"); });
  // SIGTERM once it listens; the stop it starts is measured, never cut short
  child.stdout.on("data", (c: Buffer) => { out += c.toString("utf8"); if (untilListening && out.includes("listening on")) watch.term(); });
  const code = new Promise<number | null>((resolve, reject) => {
    const t = setTimeout(() => { const ev = watch.evidence(); child.kill("SIGKILL"); reject(new Error(`still running after 90 s\nstderr: ${err}\nstdout: ${out}\n${ev}`)); }, 90_000);
    child.once("exit", (c) => { clearTimeout(t); resolve(c); });
  });
  return { code, err: () => err, out: () => out, term: watch.term, stopMs: watch.stopMs, evidence: watch.evidence };
}

/**
 * A damaged database written directly (no Space is booted to make one): a real SQLite file with a table of rows, then every byte after its 100-byte header overwritten with noise.
 * The header still says SQLite, the pages do not read: the start that opens it fails with "database disk image is malformed", as with a file damaged in use.
 */
function makeDamaged(file: string): void {
  const d = new DatabaseSync(file);
  d.exec("CREATE TABLE t(v BLOB); INSERT INTO t SELECT randomblob(1000) FROM (WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<50) SELECT x FROM c)");
  d.close();
  const b = fs.readFileSync(file);
  for (let i = 100; i < b.length; i++) b[i] = (i * 37) & 0xff;
  fs.writeFileSync(file, b);
}
const contents = (dir: string): string => fs.readdirSync(dir).filter((n) => /\.db$/.test(n)).sort().map((n) => `${n}:${createHash("sha256").update(fs.readFileSync(path.join(dir, n))).digest("hex")}`).join("\n");
const fingerprint = (dir: string): string => fs.readdirSync(dir).filter((n) => /\.db(-wal|-shm)?$/.test(n)).sort().map((n) => { const f = path.join(dir, n); return `${n}:${fs.statSync(f).mtimeMs}:${createHash("sha256").update(fs.readFileSync(f)).digest("hex")}`; }).join("\n");

for (const name of ["events.db"]) {
  test(`a damaged ${name}: the start that meets it names it and exits 3, the next one holds (up, 503 with the line, writing nothing) (a restored file: daemon.damaged-restore.test.ts)`, { timeout: 180_000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-damaged-"));
    const port = await freePort();
    try {
      // the damaged file, written directly in an empty data folder (a full boot to make a Space first cost a third of this file's time; the daemon's stop after a full
      // boot is checked in daemon.damaged-restore.test.ts and daemon.damaged-cycle.heavy.test.ts)
      makeDamaged(path.join(dir, name));
      // the start that meets it: one line, exit 3
      const fail = start(dir, port);
      assert.equal(await fail.code, 3, fail.err());
      const lines = fail.err().trim().split("\n");
      assert.equal(lines.length, 1, `one line: ${fail.err()}`);
      const line = new RegExp(`^vyred: ${name.replace(".", "\\.")} is damaged \\(database disk image is malformed\\), so the Space cannot start\\. It is not repaired here\\. Put back the last good backup on the server: vyre-server restore <backup file> --yes`);
      assert.match(lines[0]!, line);
      // the restart: it holds
      const unchanged = contents(dir);
      // the journal files the failed start's own open left beside the damaged file are cleared, so the list shows whether the hold's one check makes any
      for (const e of ["-wal", "-shm"]) fs.rmSync(path.join(dir, name) + e, { force: true });
      const filesBefore = fs.readdirSync(dir).sort();
      const held = start(dir, port);
      let res: Response | undefined;
      for (let i = 0; i < 100 && !res; i++) { try { res = await fetch(`http://127.0.0.1:${port}/healthz`); } catch { await new Promise((r) => setTimeout(r, 100)); } }
      assert.ok(res, `the held server answers: ${held.err()}`);
      assert.equal(res.status, 503, "not healthy");
      const body = await res.json() as { ok: boolean; status: string; error: { code: string; message: string } };
      assert.equal(body.ok, false);
      assert.equal(body.error.code, "space.damaged");
      assert.match(`vyred: ${body.error.message}`, line, "the body carries the line");
      const other = await fetch(`http://127.0.0.1:${port}/v1/notes/list`, { method: "POST" });
      await other.text();
      assert.equal(other.status, 503, "every request");
      assert.deepEqual(fs.readdirSync(dir).sort(), filesBefore, "the check opened the damaged file immutable: no -shm or -wal made beside it");
      // after its one check of the damaged file it touches nothing: not a byte, not a timestamp
      const before = fingerprint(dir);
      await new Promise((r) => setTimeout(r, 1500));
      assert.equal(fingerprint(dir), before, "nothing in the data folder was touched while it held");
      assert.equal(contents(dir), unchanged, "no database changed, from the start of the hold on");
      assert.equal(held.err().trim().split("\n").length, 1, `one line while it holds: ${held.err()}`);
      held.term();
      assert.equal(await held.code, 0, "it stops on SIGTERM");
      assert.ok(held.stopMs()! <= STOP_BOUND_MS, `the held server's stop took ${held.stopMs()} ms\n${held.evidence()}`);
    } finally { fs.rmSync(holdMarker(dir), { force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
