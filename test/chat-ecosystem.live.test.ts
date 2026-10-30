// Skills, plugins and outside tools on a booted daemon (CHAT-DESIGN rulings 4 and 6). Nothing inside the daemon is faked: chat, agents, the tool pipeline, the Gate, the Vault and the sandbox are
// live (on a Mac the real Seatbelt, on Linux bubblewrap). The model vendor stand-in is a scripted session that decides the way a model would: it reads the turn, loads a skill, calls tools.
//   - a skill loaded into a turn: the Space library, the agent's own skills/ folder, and a plugin's skill under its plugin name
//   - a plugin from a local marketplace installed: its command renders, its skill loads, its MCP tool works for an API model, a call that may change things is held at the Gate until approved,
//     the hook runs only in the sandbox, and the secret option reaches the server by Vault handle and never comes back
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boot, call, connect, hostLog, makeAgent, ok, post, scriptedModel, seededDir, startChat, stop, waitFor } from "./support/eco-live.ts";

const MARKET = fileURLToPath(new URL("../fixtures/plugins/test-marketplace", import.meta.url));
const SECRET = "tok-4c1d9a0e7b6f52318a90"; // secret-scan: fake
const mac = process.platform === "darwin" && spawnSync("/usr/bin/sandbox-exec", ["-n", "no-network", "/usr/bin/true"]).status === 0;
const sandboxed: string | false = mac || (process.platform === "linux" && process.env["VYRE_HEAVY_DOCKER"] === "1") ? false : "needs a Mac, or VYRE_HEAVY_DOCKER=1 with bubblewrap";

const text = (r: { content: unknown }): string => JSON.stringify(r.content);

test("a skill is loaded into a turn: the Space library, the agent's own skills/ folder and the built-in manual, nearest first", async () => {
  const model = scriptedModel(async function* (input, run) {
    const ask = input.trigger?.body ?? "";
    const agentId = input.agent.id;
    if (/list my skills/.test(ask)) {
      yield* run("tool_search", { query: "skills list" });
      const l = yield* run("skills_list", { agentId });
      yield { type: "text", text: `INDEX ${((l.content as { data: { skills: Array<{ name: string; tier: string }> } }).data.skills).map((s) => `${s.name}:${s.tier}`).join(",")}` };
    } else if (/use the intake rules/.test(ask)) {
      const r = yield* run("load_skill", { name: "intake-rules", agentId });
      yield { type: "text", text: `LOADED ${r.ok ? ((r.content as { data: { skill: { tier: string; body: string } } }).data.skill.tier + " " + (r.content as { data: { skill: { body: string } } }).data.skill.body.split("\n").find((x) => x.trim() !== "")) : "FAILED"}` };
    } else if (/use the triage steps/.test(ask)) {
      const r = yield* run("load_skill", { name: "triage", agentId });
      yield { type: "text", text: `LOADED ${r.ok ? (r.content as { data: { skill: { tier: string; body: string } } }).data.skill.tier : "FAILED"}` };
    }
  });
  const d = await boot(seededDir(), model);
  try {
    await connect(d);
    const id = await makeAgent(d, "Intake");
    await ok(d, "skills.add", { idempotencyKey: "s1", text: "---\nname: intake-rules\ndescription: How we take a new matter at intake. Use when someone asks about intake.\n---\n\nAsk for the conflict names first.\n" });
    await ok(d, "skills.add", { idempotencyKey: "s2", text: "---\nname: triage\ndescription: Space copy of triage.\n---\n\nSpace triage.\n" });
    // the agent's own skills/ folder, written the way an agent writes one
    const agent = (await ok(d, "agents.get", { agentId: id })).agent;
    const top = await ok(d, "files.list", { section: "space", folder: agent.folderId });
    const skills = top.folders.find((f: { name: string }) => f.name === "skills").folderId as string;
    const dir = (await ok(d, "files.folder.create", { idempotencyKey: "f1", parentId: skills, name: "triage" })).folder.folderId as string;
    await ok(d, "files.create", { idempotencyKey: "f2", folderId: dir, name: "SKILL.md", kind: "text", mime: "text/markdown", content: { text: "---\nname: triage\ndescription: The intake agent's own triage steps.\n---\n\nOwn triage.\n" } });

    const thread = await startChat(d, id, "sk1");
    const index = await post(d, thread, id, "list my skills", "sk1a");
    assert.match(index, /^INDEX /);
    assert.match(index, /working-in-vyre:builtin/);
    assert.match(index, /intake-rules:space/);
    assert.match(index, /triage:agent/, "the agent's own triage wins over the Space copy");
    assert.doesNotMatch(index, /triage:space/);
    assert.equal(await post(d, thread, id, "use the intake rules", "sk1b"), "LOADED space Ask for the conflict names first.");
    assert.equal(await post(d, thread, id, "use the triage steps", "sk1c"), "LOADED agent");
  } catch (e) {
    try { const ms = (await ok(d, "chat.messages.list", { threadId: lastThread })).messages; console.error("MSGS", JSON.stringify(ms.slice(-3).map((m: { body?: string }) => m.body)).slice(0, 800)); console.error("HOLDS", JSON.stringify((await ok(d, "gate.holds.list", {})).holds).slice(0, 600)); } catch { /* none */ }
    console.error("FAILED:", e instanceof Error ? e.message.slice(0, 1500) : e); throw e; } finally { await stop(d); }
});

test("a plugin from a local marketplace: command, skill and MCP tool work for an API model, a call that changes things waits at the Gate, and the hook runs only in the sandbox", { skip: sandboxed }, async () => {
  const model = scriptedModel(async function* (input, run) {
    const ask = input.trigger?.body ?? "";
    const agentId = input.agent.id;
    if (process.env["ECO_DEBUG"]) console.error("MODEL", JSON.stringify({ ask: ask.slice(0, 40), resumed: input.resumed ?? null }).slice(0, 600));
    if (input.resumed) {
      // the turn was parked at the Gate; once the asker approved, the engine ran the call and hands the model its answer
      const said = /"text":"([^"]*)"/.exec(JSON.stringify(input.resumed.result))?.[1] ?? `NO TEXT ${JSON.stringify(input.resumed)}`;
      yield { type: "text", text: `SHOUT ${input.resumed.approved ? said : "REFUSED"}` };
    } else if (/following the greeting skill/.test(ask)) {
      const r = yield* run("load_skill", { name: "greeter:greeting", agentId });
      yield { type: "text", text: `SKILL ${r.ok ? ((r.content as { data: { skill: { body: string } } }).data.skill.body.split("\n").find((l) => l.startsWith("1.")) ?? "") : "FAILED"} || ASKED ${ask.split("\n")[0]}` };
    } else if (/^echo /.test(ask)) {
      const r = yield* run("mcp__greeter-echo__echo", { text: ask.slice(5) });
      yield { type: "text", text: `ECHO ${r.ok ? (r.content as { data: { text: string } }).data.text : `FAILED ${text(r)}`}` };
    } else if (/^shout /.test(ask)) {
      const r = yield* run("mcp__greeter-echo__shout", { text: ask.slice(6) });
      yield { type: "text", text: `SHOUT ${r.ok ? (r.content as { data: { text: string } }).data.text : `FAILED ${text(r)}`}` };
    } else if (/^whoami/.test(ask)) {
      const r = yield* run("mcp__greeter-echo__whoami", {});
      yield { type: "text", text: `WHO ${r.ok ? (r.content as { data: { text: string } }).data.text : `FAILED ${text(r)}`}` };
    }
  });
  const dir = seededDir();
  const d = await boot(dir, model);
  let lastThread = "";
  try {
    const folder = await connect(d);
    const id = await makeAgent(d, "Greeter bot", "You greet people.");

    // an admin adds the marketplace and installs the plugin into the Space; the secret option is a Vault handle
    await ok(d, "vault.item.put", { idempotencyKey: "eco-echo", folderId: folder, name: "Olivia_Echo", kind: "api_key", fields: [{ key: "token", value: SECRET, secret: true }] });
    const market = (await ok(d, "plugins.marketplace.add", { idempotencyKey: "m1", source: MARKET })).marketplace;
    assert.deepEqual([market.name, market.plugins, market.allowed], ["vyre-test-market", 2, true]);
    const refused = await call(d, "plugins.config.set", { idempotencyKey: "c0", pluginId: "plg_none", config: {} });
    assert.equal(refused.status, 404);
    const plugin = (await ok(d, "plugins.install", { idempotencyKey: "p1", marketplaceId: market.marketplaceId, plugin: "greeter", scope: "space", config: { echo_token: "#Olivia_Echo.token" } })).plugin;
    assert.deepEqual(plugin.parts, { skills: ["greeting"], commands: ["hello"], agents: ["helper"], hooks: 1, mcpServers: ["echo"] });
    const plain = await call(d, "plugins.config.set", { idempotencyKey: "c1", pluginId: plugin.pluginId, config: { echo_token: SECRET } });
    assert.equal(plain.status, 422, "a secret option does not take a value");
    assert.ok(!JSON.stringify(plain.data).includes(SECRET));

    // the / command: a plugin command renders the prompt the chat sends as the person's words
    const cmd = (await ok(d, "plugins.commands.list", { agentId: id })).commands;
    assert.deepEqual(cmd.map((c: { name: string }) => c.name), ["greeter:hello"]);
    const rendered = await ok(d, "plugins.command.render", { name: "greeter:hello", args: "Dana", agentId: id });
    const thread = await startChat(d, id, "pl1");
    lastThread = thread;
    const skillTurn = await post(d, thread, id, rendered.prompt.trim(), "pl1a");
    assert.equal(skillTurn, "SKILL 1. Use the person's first name. || ASKED Greet Dana warmly, in one sentence, following the greeting skill.");

    // an MCP tool that only reads: no Gate, the server runs in the sandbox
    assert.equal(await post(d, thread, id, "echo hello there", "pl1b"), "ECHO hello there");
    // the secret reached the server through the Vault handle, and the value never came back to the model
    const who = await post(d, thread, id, "whoami", "pl1c");
    assert.match(who, new RegExp(`^WHO cwd=${path.join(dir, "work", "usr_olivia", "plugins").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} token=`));
    assert.ok(!who.includes(SECRET), who);
    assert.ok(!who.includes("token=none"), "the server got the token");

    // the hook ran after the tool call, in the sandbox work folder, and could not write one folder up
    const marker = path.join(dir, "work", "usr_olivia", "plugins", "hook-ran.txt");
    await waitFor(async () => (fs.existsSync(marker) ? true : null), 20_000);
    assert.match(fs.readFileSync(marker, "utf8"), /^PostToolUse /);
    assert.ok(!fs.existsSync(path.join(dir, "work", "usr_olivia", "hook-escape.txt")));

    // a tool that may change things is held at the Gate for the agent; once the asker approves, it runs
    const before = ((await ok(d, "chat.messages.list", { threadId: thread })).messages as unknown[]).length;
    await ok(d, "chat.post", { threadId: thread, body: "shout quiet words", mentions: [{ kind: "agent", id }], idempotencyKey: "pl1d-post" });
    const hold = await waitFor(async () => {
      await d.hooks?.pump?.();
      const h = (await ok(d, "gate.holds.list", { states: ["held"] })).holds as Array<{ id: string; taskId: string; capName: string }>;
      return h.find((x) => x.capName === "engine.mcp.call") ?? null;
    }, 30_000);
    const waitingReply = (await ok(d, "chat.messages.list", { threadId: thread })).messages as Array<{ author?: { kind?: string }; body?: string }>;
    assert.equal(waitingReply.slice(before).filter((m) => m.author?.kind === "agent" && (m.body ?? "").startsWith("SHOUT")).length, 0, "nothing ran while it was held");
    const done = await call(d, "tasks.act", { taskId: hold.taskId, action: "approve" });
    assert.equal(done.status, 200, JSON.stringify(done.data));
    const shouted = await waitFor(async () => {
      await d.hooks?.pump?.();
      const ms = (await ok(d, "chat.messages.list", { threadId: thread })).messages as Array<{ author?: { kind?: string }; body?: string }>;
      return ms.find((m) => m.author?.kind === "agent" && (m.body ?? "").startsWith("SHOUT"))?.body ?? null;
    }, 40_000);
    assert.equal(shouted, "SHOUT QUIET WORDS");

    // turned off, the plugin's tools, command and skill are gone
    await ok(d, "plugins.set_enabled", { idempotencyKey: "p2", pluginId: plugin.pluginId, enabled: false });
    assert.deepEqual((await ok(d, "plugins.commands.list", { agentId: id })).commands, []);
    assert.deepEqual((await ok(d, "skills.list", { agentId: id })).skills.filter((s: { name: string }) => s.name.startsWith("greeter:")), []);
  } catch (e) { console.error("FAILED:", e instanceof Error ? e.message.slice(0, 1500) : e); throw e; } finally { await stop(d); }
});
