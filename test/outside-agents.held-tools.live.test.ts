// The widened MCP tool set on a booted Space (lane r42-mcp, 19 Nov 2026): an MCP client calls one new capability from each Gate act (delete, connection_change, signin_change, approve). Each lands as a held card,
// a person approves one and denies one, and the answer reaches the client through agents_next. A person's own press of the same capability is never held.
import assert from "node:assert/strict";
import { expectStatus } from "../golden/steps/02-space.ts";
import { Client, signIn, withOutsideSpace as withSpace } from "./support/outside-client.ts";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const CALLS: Array<{ act: string; cap: string; tool: string; args: Record<string, unknown> }> = [
  { act: "delete", cap: "records.purge_trashed", tool: "records_purge_trashed", args: { before: 1760000000000, idempotencyKey: "h-delete" } },
  {
    act: "connection_change",
    cap: "skills.policy.set",
    tool: "skills_policy_set",
    args: { scriptsAdminOnly: true, idempotencyKey: "h-conn" },
  },
  {
    act: "signin_change",
    cap: "members.invites.guest",
    tool: "members_invites_guest",
    args: { email: "guest@walk.test", level: "view", scope: { type: "channel", id: "<made below>" }, idempotencyKey: "h-guest" },
  },
  { act: "approve", cap: "hooks.pause", tool: "hooks_pause", args: { id: "hook_walk1", paused: true } },
];

withSpace(
  "each new tool that changes access, a connection or a key, or deletes, is held for a person when an MCP client calls it; approve runs it, deny does not, and the client hears both",
  async (s, owner, mcp) => {
    const admin = s.d.token;
    const c = new Client(mcp);
    const { agentId } = await signIn(s, c, owner);
    await c.rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "claude-code", version: "2.1" },
    });
    const taskOf: Record<string, string> = {};
    const ch = expectStatus(
      await s.call("channels.create", owner, { name: "walk-channel", visibility: "public", idempotencyKey: "h-chan" }),
      200,
      "channels.create",
    );
    CALLS[2]!.args["scope"] = { type: "channel", id: (ch.channel?.channelId ?? ch.channelId ?? ch.channel?.id) as string };
    for (const k of CALLS) {
      // deferred tools are found first, then called
      const found = (await c.tool("tool_search", { query: k.tool.replace(/_/g, " ") })).json.result.structuredContent.data
        .tools as Json[];
      assert.ok(
        found.some((t) => t.name === k.tool),
        `${k.tool} is found with tool_search`,
      );
      const held = await c.tool("use_tool", { name: k.tool, arguments: k.args });
      assert.equal(held.json.result.isError, true, `${k.tool}: ${JSON.stringify(held.json.result).slice(0, 400)}`);
      assert.equal(held.json.result.structuredContent.held, true, `${k.tool} (${k.act}) is held: ${JSON.stringify(held.json.result).slice(0, 600)}`);
    }
    const holds = expectStatus(await s.call("gate.holds.list", admin, { states: ["held"] }), 200, "gate.holds.list")
      .holds as Json[];
    for (const k of CALLS) {
      const h = holds.find((x) => x.capName === k.cap);
      assert.ok(h, `a held card for ${k.cap}: ${JSON.stringify(holds.map((x) => x.capName))}`);
      assert.equal(h.askedBy?.id, agentId, `${k.cap} is held as the agent: ${JSON.stringify(h).slice(0, 500)}`);
      taskOf[k.cap] = h.taskId;
    }
    // it cannot answer its own holds
    const own = await c.tool("use_tool", { name: "tasks_act", arguments: { taskId: taskOf["skills.policy.set"], action: "approve" } });
    assert.equal(own.json.result.isError, true, "an agent cannot approve its own held act");
    // a person approves one and denies one
    expectStatus(await s.call("tasks.act", owner, { taskId: taskOf["skills.policy.set"], action: "approve" }), 200, "approve");
    expectStatus(await s.call("tasks.act", owner, { taskId: taskOf["records.purge_trashed"], action: "reject", note: "Not now" }), 200, "reject");
    await s.d.hooks?.pump?.();
    const answers: Json[] = [];
    for (let i = 0; i < 10; i++) {
      const job = (await c.tool("agents_next")).json.result.structuredContent.data.job;
      if (!job) break;
      answers.push(job);
    }
    const yes = answers.find((a) => a.taskId === taskOf["skills.policy.set"]);
    const no = answers.find((a) => a.taskId === taskOf["records.purge_trashed"]);
    assert.equal(yes?.kind, "answer", JSON.stringify(answers));
    assert.match(yes.text, /^Approved\. skills_policy_set ran as the person you act for\./, JSON.stringify(answers));
    assert.equal(no?.kind, "answer");
    assert.match(no.text, /^Not approved\. records_purge_trashed did not run\./);
    // the ones nobody answered are still waiting, and nothing ran
    const still = expectStatus(await s.call("gate.holds.list", admin, { states: ["held"] }), 200, "gate.holds.list")
      .holds as Json[];
    assert.deepEqual(still.map((x) => x.capName).sort(), ["hooks.pause", "members.invites.guest"]);
    // the same capability pressed by a person is never held
    const mine = await s.call("skills.policy.set", owner, { scriptsAdminOnly: false, idempotencyKey: "h-person" });
    assert.notEqual(mine.status, 202, "a person's own press runs at once");
  },
);
