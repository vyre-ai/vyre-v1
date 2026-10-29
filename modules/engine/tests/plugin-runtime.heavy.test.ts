// @heavy docker
// Plugin code in the real sandbox (CHAT-DESIGN ruling 6): the greeter plugin's MCP server and hook, started through the same Seatbelt (Mac) or bubblewrap (Linux) wrap a CLI engine runs in. The
// server answers MCP over its pipes; a secret option reaches it as an environment value and never comes back in a result; the hook writes in its work folder and cannot write one folder up or read
// the user's home. Runs on a Mac, or on Linux with VYRE_HEAVY_DOCKER=1 and bwrap installed.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultSandbox } from "../sandbox-default.ts";
import type { DefaultSandbox } from "../sandbox-default.ts";
import { createPluginRuntime } from "../plugin-runtime.ts";
import type { HookSpec, ServerSpec } from "../plugin-runtime.ts";
import { readTree } from "../../../host/src/seams/plugins.ts";

const mac = process.platform === "darwin" && spawnSync("/usr/bin/sandbox-exec", ["-n", "no-network", "/usr/bin/true"]).status === 0;
const linux = process.platform === "linux" && process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = mac || linux ? false : "needs a Mac, or VYRE_HEAVY_DOCKER=1 with bubblewrap";

const data = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-plugin-hv-")));
fs.chmodSync(data, 0o755);
const PLUGIN = path.join(new URL("../../../fixtures/plugins/test-marketplace/plugins/greeter", import.meta.url).pathname);
const SECRET = "tok-9f8e7d6c5b4a39281706"; // secret-scan: fake
let sandbox: DefaultSandbox | undefined;
after(async () => { await rt?.closeAll(); await sandbox?.close(); fs.rmSync(data, { recursive: true, force: true }); });

const files = readTree(PLUGIN).files;
const calls: string[] = [];
const rt = skip ? undefined : createPluginRuntime({
  dataDir: data,
  call: async (cap, input) => { calls.push(cap); if (cap === "plugins.files") return { files }; throw new Error(`unexpected ${cap}`); },
  plan: async () => (sandbox ??= await defaultSandbox({ dataDir: data })).plan,
  source: { lookup: async (h) => (h === "#Dana_Echo.token" ? { kind: "value", itemId: "vit_1", value: SECRET, spaceOnly: false, injectIntoDeployments: false } : { kind: "unknown" }) },
  reportMiss: () => undefined,
});
const who = { agentId: "agt_greeter", asker: "usr_dana" };
const server: ServerSpec = { key: "greeter/echo", name: "echo", from: "plugin", pluginId: "plg_greeter", transport: "stdio", command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/server.mjs"], env: { ECHO_TOKEN: "#Dana_Echo.token" }, files: "plg_greeter", headers: {}, needs: [] };

test("the plugin's MCP server runs in the sandbox: tools list, a call works, the secret reaches it and never comes back, and it cannot write outside its folder", { skip }, async () => {
  const tools = await rt!.tools(server, who);
  assert.deepEqual(tools.map((t) => t.name), ["echo", "shout", "whoami", "write_outside"]);
  assert.equal((await rt!.callTool(server, who, "shout", { text: "hello" })).text, "HELLO");
  const me = await rt!.callTool(server, who, "whoami", {});
  assert.match(me.text, new RegExp(`cwd=${path.join(data, "work", "usr_dana", "plugins").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.ok(!me.text.includes(SECRET), "the value never comes back");
  assert.match(me.text, /token=/);
  assert.ok(!me.text.includes("token=none"), "but the server did get it");
  const out = await rt!.callTool(server, who, "write_outside", { path: path.join(data, "work", "usr_dana", "escape.txt") });
  assert.match(out.text, /denied/);
  assert.ok(!fs.existsSync(path.join(data, "work", "usr_dana", "escape.txt")));
  assert.equal(rt!.live(), 1, "one connection is kept between calls");
  assert.ok(calls.includes("plugins.files"));
});

test("a server that is waiting for an option, or uses a handle the person may not use, does not start", { skip }, async () => {
  await assert.rejects(rt!.tools({ ...server, key: "greeter/needs", needs: ["echo_token"] }, who), /needs echo_token/);
  const denied = createPluginRuntime({ dataDir: data, call: async () => ({ files }), plan: async () => (sandbox ??= await defaultSandbox({ dataDir: data })).plan, source: { lookup: async () => ({ kind: "denied", reason: "no_access" }) } });
  await assert.rejects(denied.tools(server, { agentId: "agt_x", asker: "usr_other" }), /cannot use #Dana_Echo.token/);
  await denied.closeAll();
});

test("the hook runs in the sandbox: it writes its marker in the work folder, cannot write one folder up or read the home, and an exit code 2 comes back", { skip }, async () => {
  const hook: HookSpec = { pluginId: "plg_greeter", plugin: "greeter", event: "PostToolUse", matcher: "*", command: "node ${CLAUDE_PLUGIN_ROOT}/hooks/after-tool.mjs", args: [], timeoutSec: 20 };
  const r = await rt!.runHook(hook, who, { hook_event_name: "PostToolUse", tool_name: "records_query" });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /escaped=no home=no root=set/);
  const work = path.join(data, "work", "usr_dana", "plugins");
  assert.equal(fs.readFileSync(path.join(work, "hook-ran.txt"), "utf8"), "PostToolUse records_query\n");
  assert.ok(!fs.existsSync(path.join(data, "work", "usr_dana", "hook-escape.txt")), "nothing was written one folder up");
  const blocked = await rt!.runHook({ ...hook, command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/hooks/after-tool.mjs", "--block"] }, who, { hook_event_name: "PreToolUse", tool_name: "x" });
  assert.equal(blocked.code, 2);
  assert.match(blocked.stderr, /blocked by the test hook/);
  const slow = await rt!.runHook({ ...hook, command: "sleep 30", args: [], timeoutSec: 1 }, who, {});
  assert.equal(slow.timedOut, true);
});
