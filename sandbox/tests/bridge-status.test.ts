// The bridge ends with the status of the program it ran, and a program that died on a signal ends it the way a shell reports that: 128 plus the signal number. The Code step reads a
// processor-time kill (SIGXCPU 152 or SIGKILL 137) and a memory abort (SIGABRT 134) from that status.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { BRIDGE_SOURCE } from "../src/net/guest.ts";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address() as net.AddressInfo; s.close(() => resolve(port)); });
  });
}

async function statusOf(script: string): Promise<number | null> {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-bridge-")));
  try {
    fs.writeFileSync(path.join(dir, "bridge.mjs"), BRIDGE_SOURCE);
    const r = spawnSync(process.execPath, [path.join(dir, "bridge.mjs"), path.join(dir, "p.sock"), String(await freePort()), "--", "sh", "-c", script], { timeout: 20_000 });
    return r.status;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test("the bridge passes on an exit status, and 128 plus the number of the signal a program died on", async () => {
  assert.equal(await statusOf("exit 7"), 7);
  assert.equal(await statusOf("exit 0"), 0);
  assert.equal(await statusOf("kill -s KILL $$"), 128 + os.constants.signals.SIGKILL);
  assert.equal(await statusOf("kill -s XCPU $$"), 128 + os.constants.signals.SIGXCPU);
  assert.equal(await statusOf("kill -s ABRT $$"), 128 + os.constants.signals.SIGABRT);
});
