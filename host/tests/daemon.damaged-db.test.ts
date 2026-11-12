// A Space server whose modules.db or events.db is damaged (12 Nov 2026: a Mac mini, after an update's backup read them from the wrong kernel) used to crash-loop under Docker's restart policy
// printing only "vyred: database disk image is malformed" each time: nothing said which file, or that a backup puts it right, and every restart re-opened the damaged file.
// Now: the first start names the file and the restore command in one line and exits 3; the next start checks that one file once and HOLDS: it stays up, opens nothing else, writes
// nothing, and answers every request (/healthz included) 503 with the line, so an update rolls back, doctor says why, and the restart policy has nothing to loop on. A restored good file
// lets the next start go on as usual. Nothing is repaired (logs.db alone is set aside and made anew, by openLogSink).
// One database per file (this one: modules.db; daemon.damaged-events.test.ts: events.db), so each file stays well under the fast runner's 30 s cap.
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

const MAIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "daemon", "main.ts");
const args = (dir: string, port: number): string[] => ["--experimental-strip-types", MAIN, "--role", "space", "--data-dir", dir, "--host", "127.0.0.1", "--port", String(port), "--space", "spc_damaged0001"];

async function freePort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  const p = (s.address() as net.AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return p;
}

type Run = { code: Promise<number | null>; err: () => string; out: () => string; kill: (s: NodeJS.Signals) => void };
function start(dir: string, port: number, untilListening = false): Run {
  const child = spawn(process.execPath, args(dir, port), { stdio: ["ignore", "pipe", "pipe"] });
  let err = "", out = "";
  child.stderr.on("data", (c: Buffer) => { err += c.toString("utf8"); });
  let asked = false;
  // a clean stop is not what this test is about: SIGTERM once it listens, and SIGKILL if a busy box makes the stop slow
  child.stdout.on("data", (c: Buffer) => { out += c.toString("utf8"); if (untilListening && !asked && out.includes("listening on")) { asked = true; child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 20_000).unref(); } });
  const code = new Promise<number | null>((resolve, reject) => {
    const t = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`still running after 60 s\nstderr: ${err}\nstdout: ${out}`)); }, 60_000);
    child.once("exit", (c) => { clearTimeout(t); resolve(c); });
  });
  return { code, err: () => err, out: () => out, kill: (s) => child.kill(s) };
}

/** Every page after the first overwritten with noise: the header and the schema still read, the tables do not. */
function damage(file: string): void {
  const b = fs.readFileSync(file);
  const page = b.readUInt16BE(16) === 1 ? 65536 : b.readUInt16BE(16);
  for (let i = page; i < b.length; i++) b[i] = (i * 37) & 0xff;
  fs.writeFileSync(file, b);
  for (const e of ["-wal", "-shm"]) fs.rmSync(file + e, { force: true });
}
const contents = (dir: string): string => fs.readdirSync(dir).filter((n) => /\.db$/.test(n)).sort().map((n) => `${n}:${createHash("sha256").update(fs.readFileSync(path.join(dir, n))).digest("hex")}`).join("\n");
const fingerprint = (dir: string): string => fs.readdirSync(dir).filter((n) => /\.db(-wal|-shm)?$/.test(n)).sort().map((n) => { const f = path.join(dir, n); return `${n}:${fs.statSync(f).mtimeMs}:${createHash("sha256").update(fs.readFileSync(f)).digest("hex")}`; }).join("\n");

for (const name of ["modules.db"]) {
  test(`a damaged ${name}: the first start names it and exits 3, the next one holds (up, 503 with the line, writing nothing) (a restored file: daemon.damaged-restore.test.ts)`, { timeout: 180_000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-damaged-"));
    const port = await freePort();
    try {
      const first = start(dir, port, true);
      await first.code;
      assert.match(first.out(), /listening on/, `the first start makes the Space: ${first.err()}`);
      damage(path.join(dir, name));
      // the start that meets it: one line, exit 3
      const fail = start(dir, port);
      assert.equal(await fail.code, 3, fail.err());
      const lines = fail.err().trim().split("\n");
      assert.equal(lines.length, 1, `one line: ${fail.err()}`);
      const line = new RegExp(`^vyred: ${name.replace(".", "\\.")} is damaged \\(database disk image is malformed\\), so the Space cannot start\\. It is not repaired here\\. Put back the last good backup on the server: vyre-server restore <backup file> --yes`);
      assert.match(lines[0]!, line);
      // the restart: it holds
      const unchanged = contents(dir);
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
      // after its one check of the damaged file it touches nothing: not a byte, not a timestamp
      const before = fingerprint(dir);
      await new Promise((r) => setTimeout(r, 1500));
      assert.equal(fingerprint(dir), before, "nothing in the data folder was touched while it held");
      assert.equal(contents(dir), unchanged, "no database changed, from the start of the hold on");
      assert.equal(held.err().trim().split("\n").length, 1, `one line while it holds: ${held.err()}`);
      held.kill("SIGTERM");
      assert.equal(await held.code, 0, "it stops on SIGTERM");
    } finally { fs.rmSync(holdMarker(dir), { force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
