// The wrap of a CLI engine in a Windows Personal Space (sandbox.ts, kind "lowil"), built on any computer: vyre-lowrun starts it with the engine's argv as it was, after the folders it may
// change are labelled Low (the person's work folders, their scratch folder, the folders they added) and with its home, config and temp in the scratch folder and the egress proxy in its variables.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sandboxWrap, workFolder } from "../sandbox.ts";
import type { SandboxPlan } from "../sandbox.ts";
import { forgetLabels, setLabelRunner } from "../../../sandbox/src/win/lowrun.ts";

test("the Low-integrity wrap: the helper, the engine's argv untouched, its folders labelled Low, its home and temp in scratch, the proxy", () => {
  const data = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-lowil-")));
  const added = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-added-"));
  const labelled: string[] = [];
  setLabelRunner((_c, args) => { labelled.push(args[0] as string); return { status: 0 }; });
  forgetLabels();
  const plan: SandboxPlan = { dataDir: data, egressHosts: [], sandbox: { kind: "lowil", helper: "C:\\v\\vyre-lowrun-abc.exe", proxyPort: 4321, writable: [added] } };
  const cwd = workFolder(data, "usr_dana", "thr_1");
  const argv = sandboxWrap(plan, { homeFromScratch: true })(["C:\\e\\claude.exe", "-p", "--add-dir", cwd], { cwd, env: { ANTHROPIC_API_KEY: "k" } });
  assert.equal(argv[0], "C:\\v\\vyre-lowrun-abc.exe");
  assert.equal(argv[1], "--env");
  assert.equal(argv[3], "--");
  assert.deepEqual(argv.slice(4), ["C:\\e\\claude.exe", "-p", "--add-dir", cwd]);
  const env = Object.fromEntries(Buffer.from(argv[2] as string, "base64").toString("utf8").split("\0").map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)]));
  const scratch = path.join(data, "scratch", "usr_dana");
  assert.equal(env["HTTPS_PROXY"], "http://127.0.0.1:4321");
  assert.equal(env["NO_PROXY"], "localhost,127.0.0.1", "Vyre's MCP endpoint on loopback is reached directly");
  assert.equal(env["USERPROFILE"], path.join(scratch, "home"));
  assert.equal(env["CLAUDE_CONFIG_DIR"], path.join(scratch, "home", ".claude"));
  assert.equal(env["TEMP"], path.join(scratch, "tmp"));
  assert.ok(!("ANTHROPIC_API_KEY" in env), "the key stays in the spawn's own environment");
  assert.deepEqual(labelled, [path.join(data, "work", "usr_dana"), fs.realpathSync(scratch), added]);
  setLabelRunner(null);
  forgetLabels();
});
