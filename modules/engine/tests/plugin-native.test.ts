// Plugins on a Claude Code or Codex agent, natively (CHAT-DESIGN ruling 6): the plugin is written into the engine's own config in its work folder, and the CLI session sees its commands and skills and
// starts its MCP server. The CLI is the golden-streams stand-in, a real process started with the argv the driver builds. A secret is a Vault handle the fill puts in the environment; no value is written.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CLI_ADAPTERS, createCliDriver } from "../../../agent/src/drivers/cli/index.ts";
import { collect, driverDeps, newSpy, specOf, texts, turnOf } from "../../../agent/fixtures/golden-streams/rig.ts";
import { readTree } from "../../../host/src/seams/plugins.ts";
import { nativePlugins } from "../plugin-native.ts";

const GREETER = new URL("../../../fixtures/plugins/test-marketplace/plugins/greeter", import.meta.url).pathname;
const files = readTree(GREETER).files;
const call = (enabled = true) => async (cap: string): Promise<unknown> => {
  if (cap === "plugins.list") return { plugins: [{ pluginId: "plg_greeter", name: "greeter", enabled }] };
  if (cap === "plugins.files") return { files };
  if (cap === "plugins.mcp.servers") return { servers: [
    { key: "greeter/echo", name: "echo", from: "plugin", pluginId: "plg_greeter", transport: "stdio", command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/server.mjs"], env: { ECHO_TOKEN: "#Dana_Echo.token", REGION: "eu" }, needs: [] },
    { key: "crm", name: "crm", from: "connection", transport: "http", args: [], env: {}, needs: [] },
    { key: "greeter/waiting", name: "waiting", from: "plugin", pluginId: "plg_greeter", transport: "stdio", command: "node", args: [], env: {}, needs: ["echo_token"] },
  ] };
  throw new Error(`unexpected ${cap}`);
};
const work = (): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-native-")));

test("Claude Code: the plugin folder is in the work folder, the CLI session sees its command and skill, and its server is configured with the secret by variable name only", async () => {
  const w = work();
  const native = (await nativePlugins({ call: call() }, "claude_code", "agt_intake", "per_dana", w))!;
  assert.deepEqual(native.dirs, [path.join(w, ".plugins", "plg_greeter")]);
  assert.deepEqual(Object.keys(native.mcpServers), ["echo"], "a remote connection and a server waiting for an option are not written");
  assert.deepEqual(native.secrets, { VYRE_PLUGIN_1: "#Dana_Echo.token" });
  assert.equal(native.mcpServers["echo"]!.args[0], path.join(w, ".plugins", "plg_greeter", "server.mjs"));
  assert.deepEqual(native.mcpServers["echo"]!.env, { ECHO_TOKEN: "${VYRE_PLUGIN_1}", REGION: "eu" });
  assert.ok(!JSON.stringify(native).includes("s3cret"));
  const spy = newSpy();
  const session = await createCliDriver(CLI_ADAPTERS.claude_code, driverDeps(spy, { plugins: () => native, workFolder: () => w, env: () => ({ VYRE_PLUGIN_1: "filled-by-the-vault" }) })).open(specOf());
  const said = texts(await collect(session.send(turnOf("plugins")))).join("");
  await session.close();
  assert.ok(spy.launches[0]!.includes("--plugin-dir"));
  assert.match(said, /command:hello/);
  assert.match(said, /skill:greeting:description: How to greet a person warmly/);
  assert.match(said, /mcp:plugin_echo:\{"ECHO_TOKEN":"\$\{VYRE_PLUGIN_1\}","REGION":"eu"\}/);
  assert.match(said, /token:filled-by-the-vault/);
  assert.ok(spy.launches[0]!.includes("mcp__plugin_echo__*"), "its tools are allowed");
  assert.ok(!JSON.stringify(spy.launches).includes("filled-by-the-vault"), "the value is in the environment only, never in the command line");
});

test("Codex: the skills go where Codex looks for them, named for their plugin, and the server is a -c override with the variable name", async () => {
  const w = work();
  const native = (await nativePlugins({ call: call() }, "codex", "agt_intake", "per_dana", w))!;
  const spy = newSpy();
  const session = await createCliDriver(CLI_ADAPTERS.codex, driverDeps(spy, { plugins: () => native, workFolder: () => w })).open(specOf());
  const said = texts(await collect(session.send(turnOf("plugins")))).join("");
  await session.close();
  assert.match(said, /skill:greeter-greeting:description: How to greet a person warmly/);
  assert.match(said, /mcp:plugin_echo/);
  assert.ok(fs.existsSync(path.join(w, ".codex", "skills", "greeter-greeting", "SKILL.md")));
  assert.ok(spy.launches[0]!.includes('mcp_servers.plugin_echo.env_vars=["ECHO_TOKEN", "REGION"]'), spy.launches[0]!.join(" "));
});

test("an agent with no enabled plugin gets nothing written", async () => {
  const w = work();
  assert.equal(await nativePlugins({ call: call(false) }, "claude_code", "agt_intake", "per_dana", w), null);
  assert.equal(fs.existsSync(path.join(w, ".plugins")), false);
});
