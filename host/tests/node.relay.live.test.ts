// An engine process on a computer that joined the Space, on a booted daemon: the Space starts a process on the node over the node's live socket, feeds it input, reads its output and end, and
// kills it; a node that is not connected is refused with the server_off code; a node that goes away ends its processes. The node runs in this process (runComputeNode) with a launcher that starts
// a real child process; the Space's loopback address in the process's arguments is rewritten to the address the node joined by.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NodeLauncher, NodeProc } from "../src/compute/node.ts";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { boot as bootRig, enroll } from "./node-rig.ts";

const boot = () => bootRig(bootCore);


/** A launcher that starts a real child process, as the node's sandboxed one would. */
function childLauncher(seen: { argv: string[][]; env: Record<string, string>[]; cwd: string[] }): NodeLauncher {
  return {
    async spawn(spec): Promise<NodeProc> {
      seen.argv.push([...spec.argv]); seen.env.push({ ...spec.env }); seen.cwd.push(spec.cwd ?? "");
      const [cmd, ...args] = spec.argv;
      const child = spawn(cmd!, args, { cwd: spec.cwd, env: { ...process.env, ...spec.env }, stdio: ["pipe", "pipe", "pipe"] });
      let tail = "";
      child.stderr.setEncoding("utf8"); child.stderr.on("data", (c: string) => { tail = (tail + c).slice(-4096); });
      const exited = new Promise<{ code: number | null; signal: string | null }>((r) => child.once("close", (code, signal) => r({ code, signal })));
      await new Promise<void>((ok, bad) => { child.once("spawn", ok); child.once("error", bad); });
      return {
        pid: child.pid, stdout: child.stdout as AsyncIterable<Uint8Array>, exited, stderrTail: () => tail,
        write: (data) => new Promise<void>((ok, bad) => child.stdin.write(data, (e) => (e ? bad(e) : ok()))),
        endInput: () => { child.stdin.end(); }, kill: (sig = "SIGTERM") => { child.kill(sig); },
      };
    },
  };
}

const text = async (it: AsyncIterable<Uint8Array>): Promise<string> => { let out = ""; for await (const c of it) out += Buffer.from(c).toString("utf8"); return out; };

test("the Space runs a process on an approved node: input goes in, output and the end come back, the loopback address is the node's server address, and a kill ends it", async () => {
  const { d, dir } = await boot();
  const nodeDir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-relay-node-"));
  const log: string[] = [];
  const seen = { argv: [] as string[][], env: [] as Record<string, string>[], cwd: [] as string[] };
  const { nodeId, abort, running } = await enroll(d, nodeDir, log, childLauncher(seen));
  try {
    const prog = "process.stdin.on('data',c=>process.stdout.write('echo:'+c)).on('end',()=>{process.stdout.write('|'+process.env.SECRET+'|'+process.argv[1]);process.exit(3)})";
    const proc = await d.nodeRelay.spawnProc(nodeId, { argv: [process.execPath, "-e", prog, "http://127.0.0.1:8421/mcp/x"], env: { SECRET: "http://localhost:1/s" } });
    assert.ok(proc.pid !== undefined);
    await proc.write("hello ");
    await proc.write("node");
    proc.endInput();
    const out = await text(proc.stdout);
    const exit = await proc.exited;
    assert.ok(out.startsWith("echo:hello echo:node") || out.startsWith("echo:hello node"), out);
    assert.ok(out.includes(`|${d.url}/s|${d.url}/mcp/x`), `the Space's loopback address became the node's server address: ${out}`);
    assert.equal(exit.code, 3);
    assert.ok(seen.cwd[0]!.startsWith(path.join(nodeDir, "turns")), "the engine works in a folder of the node's own");
    assert.ok(log.some((l) => /engine prc_[a-f0-9]+ started/.test(l)) && log.some((l) => /engine prc_[a-f0-9]+ ended: 3/.test(l)), JSON.stringify(log));

    const long = await d.nodeRelay.spawnProc(nodeId, { argv: [process.execPath, "-e", "setInterval(()=>{},1000)"], env: {} });
    long.kill("SIGKILL");
    const killed = await long.exited;
    assert.equal(killed.signal, "SIGKILL");

    await assert.rejects(() => d.nodeRelay.spawnProc("srv_nobody", { argv: ["x"], env: {} }), (e) => (e as { code?: string }).code === "engine.server_off");
  } finally { abort.abort(); await running.catch(() => undefined); await d.stop(); fs.rmSync(nodeDir, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a node that is not running an engine launcher refuses, and a node that goes away ends the process it was running", async () => {
  const { d, dir } = await boot();
  const nodeDir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-relay-node-"));
  const log: string[] = [];
  const seen = { argv: [] as string[][], env: [] as Record<string, string>[], cwd: [] as string[] };
  const { nodeId, abort, running } = await enroll(d, nodeDir, log, childLauncher(seen));
  try {
    const proc = await d.nodeRelay.spawnProc(nodeId, { argv: [process.execPath, "-e", "setInterval(()=>{},1000)"], env: {} });
    await assert.rejects(() => d.nodeRelay.spawnProc(nodeId, { argv: ["definitely-not-installed-xyz"], env: {} }).then(() => { throw new Error("started"); }), (e) => (e as { code?: string }).code !== undefined);
    abort.abort();
    await running.catch(() => undefined);
    const gone = await proc.exited;
    assert.ok(gone.code === null, "the process ended as killed when its node went away");
    await assert.rejects(() => d.nodeRelay.spawnProc(nodeId, { argv: ["x"], env: {} }), (e) => (e as { code?: string }).code === "engine.server_off");
  } finally { abort.abort(); await d.stop(); fs.rmSync(nodeDir, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
});
