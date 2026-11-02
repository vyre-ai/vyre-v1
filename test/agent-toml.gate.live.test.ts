// agent.toml is an agent's settings, so saving it is changing them. On a booted daemon: an outside agent signed in through the MCP door may not change an agent's settings with agents.update (person only),
// and it may not do the same by writing the agent's agent.toml through Files (files.save, files.write, files.restore_version). The write is refused before anything is written, the file keeps its text
// and the agent keeps running what it ran. The owner's own save of the same file still applies.
import test from "node:test";
import assert from "node:assert/strict";
import { bootAgentGateSpace, LIVE_FOR_GATE_REPLY } from "../golden/steps/07-agent-gate.ts";
import { expectStatus } from "../golden/steps/02-space.ts";
import type { FlowSpace } from "../golden/steps/02-space.ts";
import { Client, signIn } from "./support/outside-client.ts";
import type { Json } from "./support/outside-client.ts";

const LIVE = [...LIVE_FOR_GATE_REPLY, "mcp", "audit", "spaces"];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function tomlOf(s: FlowSpace, owner: string, agentId: string): Promise<{ fileId: string; text: string; version: number }> {
  const agent = expectStatus(await s.call("agents.get", owner, { agentId }), 200, "agents.get").agent;
  const listed = expectStatus(await s.call("files.list", owner, { section: "space", folder: agent.folderId, limit: 100 }), 200, "files.list");
  const file = (listed.files as Json[]).find((f) => f.name === "agent.toml");
  assert.ok(file, "the agent has its agent.toml");
  const read = expectStatus(await s.call("files.read", owner, { fileId: file.fileId, as: "text" }), 200, "files.read");
  return { fileId: file.fileId, text: read.text as string, version: file.version as number };
}

const modelOf = async (s: FlowSpace, owner: string, agentId: string): Promise<string | undefined> => expectStatus(await s.call("agents.get", owner, { agentId }), 200, "agents.get").agent.model;

/** The model the agent runs once the Files consumer has had its turn: it reads the saved file after commit. */
async function settled(s: FlowSpace, owner: string, agentId: string, want?: string): Promise<string | undefined> {
  let model = await modelOf(s, owner, agentId);
  for (let i = 0; i < 40 && model !== want; i++) { await sleep(100); model = await modelOf(s, owner, agentId); }
  return model;
}

test("an outside agent cannot change an agent's settings by writing its agent.toml; the owner's own save still applies", async () => {
  const s = await bootAgentGateSpace(LIVE);
  try {
    const owner = s.signedIn("usr_olivia");
    const agentId = expectStatus(await s.call("agents.create", owner, { name: "Intake", role: "Use me when a form arrives.", idempotencyKey: "toml-gate-1" }), 200, "agents.create").agent.agentId as string;
    expectStatus(await s.call("agents.update", owner, { agentId, patch: { model: "claude-sonnet-5-5" } }), 200, "agents.update");
    const before = await tomlOf(s, owner, agentId);
    assert.match(before.text, /claude-sonnet-5-5/);

    const c = new Client(`${s.d.url}/mcp`);
    await signIn(s, c, owner);
    await c.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } });
    const use = async (name: string, args: Record<string, unknown>): Promise<Json> => (await c.tool("use_tool", { name, arguments: args })).json.result;

    // the settings capability is closed to it at the door
    const direct = await use("agents_update", { agentId, patch: { model: "claude-opus-5-5" } });
    assert.equal(direct.isError, true);
    assert.equal(direct.structuredContent.error.details?.reason, "person_only");

    // and so is the file: a richer model, a Vault key and an open tool list, written three ways
    const widened = before.text.replace("claude-sonnet-5-5", "claude-opus-5-5").replace(/\[vault\]\nkeys = \[\]/, '[vault]\nkeys = ["#Olivia_Key"]');
    assert.notEqual(widened, before.text);
    assert.match(widened, /#Olivia_Key/);
    const tries: Array<[string, Record<string, unknown>]> = [
      ["files_save", { fileId: before.fileId, text: widened, acceptWarnings: true }],
      ["files_write", { fileId: before.fileId, content: { text: widened } }],
    ];
    for (const [tool, args] of tries) {
      const r = await use(tool, args);
      assert.equal(r.isError, true, `${tool} is refused: ${JSON.stringify(r).slice(0, 400)}`);
      assert.equal(r.structuredContent.error.details?.reason, "agent_settings", tool);
      assert.match(r.structuredContent.error.message, /settings/i, tool);
    }
    const versions = expectStatus(await s.call("files.versions", owner, { fileId: before.fileId }), 200, "files.versions").versions as Json[];
    const first = versions.reduce((a, b) => (a.n < b.n ? a : b));
    const restore = await use("files_restore_version", { fileId: before.fileId, versionId: first.versionId });
    assert.equal(restore.isError, true, `files_restore_version is refused: ${JSON.stringify(restore).slice(0, 400)}`);
    assert.equal(restore.structuredContent.error.details?.reason, "agent_settings");

    const after = await tomlOf(s, owner, agentId);
    assert.equal(after.text, before.text, "nothing was written to agent.toml");
    assert.equal(after.version, before.version, "no version was added");
    assert.equal(await settled(s, owner, agentId, "claude-opus-5-5"), "claude-sonnet-5-5", "the agent runs what it ran");
    const agent = expectStatus(await s.call("agents.get", owner, { agentId }), 200, "agents.get").agent;
    assert.deepEqual(agent.vaultKeys, [], "no Vault key was added");

    // the owner may: the same save through Files applies
    expectStatus(await s.call("files.save", owner, { fileId: before.fileId, text: before.text.replace("claude-sonnet-5-5", "claude-opus-5-5"), acceptWarnings: true }), 200, "files.save by the owner");
    assert.equal(await settled(s, owner, agentId, "claude-opus-5-5"), "claude-opus-5-5", "the owner's save is what the next run uses");
  } finally { await s.stop(); }
});
