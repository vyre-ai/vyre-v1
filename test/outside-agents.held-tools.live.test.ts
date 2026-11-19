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
    cap: "sites.password_set",
    tool: "sites_password_set",
    args: { siteId: "<made below>", password: "a-long-password-1" },
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
    // a site the person owns and shares with the whole Space, so the agent acting for them may open it
    const tree = expectStatus(await s.call("files.tree", owner, {}), 200, "files.tree").roots as Json[];
    const folderId = tree.find((r) => r.key === "personal")!.folderId as string;
    const made = expectStatus(
      await s.call("sites.create", owner, { name: "Walk site", access: "space", folderId, idempotencyKey: "h-site" }),
      200,
      "sites.create",
    );
    CALLS[2]!.args["siteId"] = (made.site?.siteId ?? made.siteId) as string;
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
      assert.equal(h.askedBy?.id ?? h.principal?.id, agentId, `${k.cap} is held as the agent: ${JSON.stringify(h).slice(0, 500)}`);
      taskOf[k.cap] = h.taskId;
    }
    // the class (r-review, 19 Nov): no tool of the task family lets an agent decide, move, take, hand on or delete the task a Gate hold lives in
    const held = taskOf["hooks.pause"]!;
    const tryAll: Array<[string, Record<string, unknown>]> = [
      ["tasks_act", { taskId: held, action: "approve" }],
      ["tasks_decide", { taskId: held, verdict: "approve" }],
      ["tasks_review", { taskId: held, verdict: "approve" }],
      ["tasks_transition", { taskId: held, to: "done" }],
      ["tasks_submit", { taskId: held, summary: "done" }],
      ["tasks_take", { taskId: held }],
      ["tasks_release", { taskId: held }],
      ["tasks_delegate", { taskId: held, to: { kind: "agent", id: agentId } }],
      ["tasks_assign", { taskId: held, slot: "approver", to: { kind: "agent", id: agentId } }],
      ["tasks_block", { taskId: held, reason: "x" }],
      ["tasks_delete", { taskId: held }],
      ["runs_resume", { runId: "run_walk1", reason: "approval" }],
    ];
    for (const [tool, args] of tryAll) {
      const r = await c.tool("use_tool", { name: tool, arguments: { ...args, idempotencyKey: `sweep-${tool}` } });
      assert.ok(r.json.error || r.json.result.isError === true, `${tool} did not stop an agent on a held act: ${JSON.stringify(r.json).slice(0, 300)}`);
    }
    const after = expectStatus(await s.call("gate.holds.list", admin, { states: ["held"] }), 200, "gate.holds.list").holds as Json[];
    assert.ok(after.some((x) => x.taskId === held && x.state === "held"), "the held act is still waiting after every attempt");
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
    assert.deepEqual(still.map((x) => x.capName).sort(), ["hooks.pause", "sites.password_set"]);
    // the same capability pressed by a person is never held
    const mine = await s.call("skills.policy.set", owner, { scriptsAdminOnly: false, idempotencyKey: "h-person" });
    assert.notEqual(mine.status, 202, "a person's own press runs at once");
  },
);

withSpace(
  "an app with the setup grant is held the same way: one hold for a delete and one for a connection change, never two cards for one act and never none",
  async (s, owner, mcp) => {
    const admin = s.d.token;
    const c = new Client(mcp);
    await signIn(s, c, owner, { setup: true });
    await c.rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "claude-code", version: "2.1" },
    });
    const run = async (tool: string, args: Record<string, unknown>): Promise<Json> => {
      await c.tool("tool_search", { query: tool.replace(/_/g, " ") });
      return (await c.tool("use_tool", { name: tool, arguments: args })).json.result;
    };
    const a = await run("records_purge_trashed", { before: 1760000000000, idempotencyKey: "g-del" });
    const b = await run("skills_policy_set", { scriptsAdminOnly: true, idempotencyKey: "g-conn" });
    const holds = expectStatus(await s.call("gate.holds.list", admin, { states: ["held"] }), 200, "gate.holds.list")
      .holds as Json[];
    const held = (r: Json): boolean => r.structuredContent?.held === true || r.structuredContent?.asksPerson === true;
    assert.ok(held(a) && held(b), `both are stopped: ${JSON.stringify([a, b]).slice(0, 500)}`);
    const caps = holds.map((x) => x.capName).sort();
    assert.deepEqual(
      caps.filter((x) => x === "records.purge_trashed" || x === "skills.policy.set"),
      ["records.purge_trashed", "skills.policy.set"],
      "exactly one hold for each act",
    );
  },
);
