// The Personal daemon (roles space,device, as the desktop shell starts it) that cannot start its gateway ends, non-zero, and says why on stderr (host/src/daemon/main.ts). Before, the failed start left the scheduler and the stores running, so the process
// stayed alive with the one line "the gateway did not start" and no cause; the desktop shell that started it waited out its timeout ("Personal Space did not start in time") instead of showing the reason.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "daemon", "main.ts");

test("a daemon whose gateway cannot listen exits 1 with the reason, and does not stay alive", { timeout: 60_000 }, async () => {
  const held = net.createServer();
  await new Promise<void>((r) => held.listen(0, "127.0.0.1", () => r()));
  const port = (held.address() as net.AddressInfo).port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-startfail-"));
  try {
    const child = spawn(process.execPath, ["--experimental-strip-types", MAIN, "--role", "space,device", "--data-dir", dir, "--host", "127.0.0.1", "--port", String(port), "--space-kind", "personal", "--space-name", "Personal", "--space", "spc_startfail01"], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "", out = "";
    child.stderr.on("data", (c: Buffer) => { err += c.toString("utf8"); });
    child.stdout.on("data", (c: Buffer) => { out += c.toString("utf8"); });
    const code = await new Promise<number | null>((resolve, reject) => {
      const t = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`still running after 45 s\nstderr: ${err}`)); }, 45_000);
      child.once("exit", (c) => { clearTimeout(t); resolve(c); });
    });
    assert.equal(code, 1);
    assert.match(err, /vyred: the gateway did not start on 127\.0\.0\.1:\d+: listen EADDRINUSE/, err);
    assert.ok(!out.includes("listening on"), "it never said it was listening");
  } finally { held.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
