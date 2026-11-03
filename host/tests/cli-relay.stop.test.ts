// A computer that stops ends its engines first (host/src/compute/node.ts cliRelay.stopAll): the daemon's stop waits until each has exited and its work folder is gone, so on Windows nothing
// it started still works in (and holds) a folder of its data directory, and an update or uninstall can remove it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cliRelay } from "../src/compute/node.ts";
import type { NodeLauncher, NodeProc } from "../src/compute/node.ts";

function slowProc(): { proc: NodeProc; killed: string[] } {
  const killed: string[] = [];
  let exit: (v: { code: number | null; signal: string | null }) => void = () => undefined;
  const exited = new Promise<{ code: number | null; signal: string | null }>((r) => { exit = r; });
  // ends a little after it is killed, as a process tree does
  const proc: NodeProc = { pid: 1, stdout: (async function* () { await exited; })(), write: async () => undefined, endInput: () => undefined, exited, stderrTail: () => "", kill: (s) => { killed.push(s ?? "SIGTERM"); setTimeout(() => exit({ code: null, signal: "SIGKILL" }), 150); } };
  return { proc, killed };
}

test("stopAll ends every engine, waits for each to exit and its folder to be removed, and starts none after", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-relay-stop-"));
  const made: string[] = [];
  const procs: Array<ReturnType<typeof slowProc>> = [];
  const launcher: NodeLauncher = {
    workFolder: (who, proc) => { const d = path.join(dataDir, "w", who, proc); fs.mkdirSync(d, { recursive: true }); made.push(d); return d; },
    spawn: async () => { const p = slowProc(); procs.push(p); return p.proc; },
  };
  const said: Array<Record<string, unknown>> = [];
  const r = cliRelay({ launcher, dataDir, server: "http://space.test", log: () => undefined });
  r.frame({ t: "cli_spawn", proc: `prc_${"a".repeat(24)}`, argv: ["claude", "-p"], env: {}, person: "usr_a" }, (m) => said.push(m));
  r.frame({ t: "cli_spawn", proc: `prc_${"b".repeat(24)}`, argv: ["claude", "-p"], env: {}, person: "usr_a" }, (m) => said.push(m));
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(r.running(), 2);
  await r.stopAll();
  assert.equal(r.running(), 0);
  assert.deepEqual(procs.map((p) => p.killed), [["SIGKILL"], ["SIGKILL"]]);
  for (const d of made) assert.equal(fs.existsSync(d), false, `${d} is removed before stopAll returns`);
  assert.equal(said.filter((m) => m["t"] === "cli_exit").length, 2);
  r.frame({ t: "cli_spawn", proc: `prc_${"c".repeat(24)}`, argv: ["claude", "-p"], env: {}, person: "usr_a" }, (m) => said.push(m));
  assert.equal(said.at(-1)?.["t"], "cli_failed", "a stopped computer starts no engine");
  assert.equal(procs.length, 2);
  fs.rmSync(dataDir, { recursive: true, force: true });
});
