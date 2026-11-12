// A Space server whose modules.db or events.db is damaged (12 Nov 2026: a Mac mini, after an update's backup read them from the wrong kernel) used to crash-loop under Docker's restart policy
// printing only "vyred: database disk image is malformed" each time: nothing said which file, or that a backup puts it right. It now names the file and the restore command, in one line,
// and exits 3. Nothing is repaired (logs.db alone is set aside and made anew, by openLogSink).
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "daemon", "main.ts");
const args = (dir: string): string[] => ["--experimental-strip-types", MAIN, "--role", "space", "--data-dir", dir, "--host", "127.0.0.1", "--port", "0", "--space", "spc_damaged0001"];

async function run(dir: string, untilListening: boolean): Promise<{ code: number | null; err: string; out: string }> {
  const child = spawn(process.execPath, args(dir), { stdio: ["ignore", "pipe", "pipe"] });
  let err = "", out = "";
  child.stderr.on("data", (c: Buffer) => { err += c.toString("utf8"); });
  child.stdout.on("data", (c: Buffer) => { out += c.toString("utf8"); if (untilListening && out.includes("listening on")) child.kill("SIGTERM"); });
  const code = await new Promise<number | null>((resolve, reject) => {
    const t = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`still running after 40 s\nstderr: ${err}\nstdout: ${out}`)); }, 40_000);
    child.once("exit", (c) => { clearTimeout(t); resolve(c); });
  });
  return { code, err, out };
}

/** Every page after the first overwritten with noise: the header and the schema still read, the tables do not. */
function damage(file: string): void {
  const b = fs.readFileSync(file);
  const page = b.readUInt16BE(16) === 1 ? 65536 : b.readUInt16BE(16);
  for (let i = page; i < b.length; i++) b[i] = (i * 37) & 0xff;
  fs.writeFileSync(file, b);
  for (const e of ["-wal", "-shm"]) fs.rmSync(file + e, { force: true });
}

for (const name of ["modules.db", "events.db"]) {
  test(`a damaged ${name} stops the Space with one line that names it and the restore command, and exit code 3`, { timeout: 90_000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-damaged-"));
    try {
      const first = await run(dir, true);
      assert.match(first.out, /listening on/, `the first start makes the Space: ${first.err}`);
      damage(path.join(dir, name));
      const r = await run(dir, false);
      assert.equal(r.code, 3, r.err);
      const lines = r.err.trim().split("\n");
      assert.equal(lines.length, 1, `one line: ${r.err}`);
      assert.match(lines[0]!, new RegExp(`^vyred: ${name.replace(".", "\\.")} is damaged \\(database disk image is malformed\\), so the Space cannot start\\. It is not repaired here\\. Put back the last good backup on the server: vyre-server restore <backup file> --yes`));
      assert.ok(!r.out.includes("listening on"));
      assert.ok(fs.existsSync(path.join(dir, name)), "the damaged file is left where it is");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
