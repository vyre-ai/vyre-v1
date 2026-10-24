// Every MCP tool call is the intersection of the caller's access and the person's (ARCH 4.5 rule 5, 6.7; spec 2.2). Run against the real kernel authorize: an outside tool (a service capped by its
// owner) or a CLI engine's agent, acting for a person, is allowed exactly when BOTH hold the level the capability needs, in every combination of levels, through the real MCP server and tool session.
// Scopes narrow an outside tool further and are checked on top.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize, LEVEL_RANK } from "../../../kernel/src/authorize/index.ts";
import type { Level } from "../../../kernel/src/authorize/index.ts";
import { codeForReason, fail } from "../../../host/src/routes/errors.ts";
import type { Invoke } from "../../../host/src/invoke.ts";
import { createMcpServer } from "../../../agent/src/mcp/index.ts";
import type { McpCaller, Scopes } from "../../../agent/src/mcp/index.ts";
import { loadGenerated } from "../../../agent/src/tools/harness.ts";
import type { ErrorCode } from "../../../packages/contracts/src/types.ts";

const g = loadGenerated();
const NOW = 1_000;
const PERSON = "per_dana";
const AGENT = "agt_intake";
const ACTOR = "act_cc";
const LEVELS: Array<Level | null> = [null, "view", "use", "edit", "manage"];
const rank = (l: Level | null): number => (l === null ? 0 : LEVEL_RANK[l]);
const FULL: Scopes = { read: true, post: true, readChangesets: true, writeBranch: true };

function world(levels: { person: Level | null; agent: Level | null; actor: Level | null }): AccessSnapshot {
  const snap = new AccessSnapshot();
  snap.putRole({ id: "full", clearance: 3, perms: [], name: "Full" });
  snap.putPrincipal({ id: PERSON, kind: "person", status: "active", name: "Dana" });
  snap.putPrincipal({ id: AGENT, kind: "agent", owner: PERSON, status: "active", name: "Intake" });
  // An outside tool is a service capped by the person who connected it.
  snap.putPrincipal({ id: ACTOR, kind: "svc", owner: PERSON, status: "active", name: "Claude Code" });
  for (const id of [PERSON, AGENT, ACTOR]) snap.addPrincipalRole({ holder: id, role: "full" });
  snap.putResource({ id: "R1", type: "folder", parent_id: null, label: 0, owner_id: null, holds: 0 });
  for (const [who, level] of [[PERSON, levels.person], [AGENT, levels.agent], [ACTOR, levels.actor]] as const) {
    if (level !== null) snap.putGrant({ id: `g_${who}`, subject_kind: "actor", subject_id: who, resource_type: "folder", resource_id: "R1", level });
  }
  return snap;
}

/** The pipeline's authorize step with the real kernel, and nothing else: allow, or the error the reason maps to. */
function pipeline(snap: AccessSnapshot, calls: string[]): Invoke {
  return async (cap, _input, seed) => {
    const row = g.caps.get(cap);
    assert.ok(row, `capability ${cap}`);
    const d = authorize(snap, {
      principal: seed.principal.id, actingFor: seed.actingFor, action: { perm: null, level: row.level }, resource: { type: "folder", id: "R1" }, cap, now: NOW,
    });
    if (d.effect !== "allow") throw fail(codeForReason(d.reason) as ErrorCode, "t".repeat(32), { details: { cap, reason: d.reason } });
    calls.push(cap);
    return { status: "ok", output: { cap }, traceId: "t".repeat(32) };
  };
}

const callerOf = (kind: "outside" | "driver", withPerson = true): McpCaller =>
  kind === "outside"
    ? { kind, sessionId: "ses_o", space: "spc_1", principal: { kind: "actor", id: ACTOR }, ...(withPerson ? { actingFor: PERSON } : {}), scopes: FULL }
    : { kind, sessionId: "ses_d", space: "spc_1", principal: { kind: "agent", id: AGENT }, ...(withPerson ? { actingFor: PERSON } : {}), threadId: "thr_1" };

function serverFor(snap: AccessSnapshot, caller: McpCaller, calls: string[]) {
  const server = createMcpServer({ catalog: g.catalog, defaults: g.defaults, invoke: pipeline(snap, calls), open: async () => caller });
  let n = 0;
  return async (name: string): Promise<{ allowed: boolean; code?: string }> => {
    const r = await server.handle({ method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: {} } }) });
    const res = (JSON.parse(r.body) as { result: { isError: boolean; structuredContent: { error?: { code: string } } } }).result;
    return res.isError ? { allowed: false, code: res.structuredContent.error?.code ?? "?" } : { allowed: true };
  };
}

/** Default tools that run through the pipeline (not on the agent computer) and whose capability has a level. */
const sample = g.catalog.all.filter((t) => g.defaults.has(t.name) && t.local === "none" && t.toolset !== "engineer" && t.name !== "tool_search");

test("a CLI engine's agent acting for a person is allowed exactly when both hold the level the tool needs (25 combinations)", async () => {
  let allowed = 0, refused = 0;
  for (const person of LEVELS) for (const agent of LEVELS) {
    const calls: string[] = [];
    const call = serverFor(world({ person, agent, actor: null }), callerOf("driver"), calls);
    for (const t of sample) {
      const need = rank(g.caps.get(t.cap)!.level);
      const both = rank(person) >= need && rank(agent) >= need;
      const r = await call(t.name);
      assert.equal(r.allowed, both, `${t.name} needs ${g.caps.get(t.cap)!.level}; person ${person}, agent ${agent}: ${r.code ?? "allowed"}`);
      if (r.allowed) { allowed++; assert.ok(rank(person) >= need && rank(agent) >= need, "never exceeds either"); } else refused++;
    }
  }
  assert.ok(allowed > 100 && refused > 100, `both outcomes are exercised (${allowed} allowed, ${refused} refused)`);
});

test("an outside tool acting for the person who connected it never gets more than the tool or the person has (25 combinations, all scopes on)", async () => {
  let allowed = 0;
  for (const person of LEVELS) for (const actor of LEVELS) {
    const calls: string[] = [];
    const call = serverFor(world({ person, agent: null, actor }), callerOf("outside"), calls);
    for (const t of sample) {
      const need = rank(g.caps.get(t.cap)!.level);
      const r = await call(t.name);
      if (r.allowed) {
        allowed++;
        assert.ok(rank(person) >= need, `${t.name}: allowed above the person (${person})`);
        assert.ok(rank(actor) >= need, `${t.name}: allowed above the tool (${actor})`);
      }
    }
    // Every call that got through is one the pipeline saw: the server added no path around it.
    for (const c of calls) assert.ok(rank(g.caps.get(c)!.level) <= Math.min(rank(person), rank(actor)), `${c} reached the pipeline above both`);
  }
  assert.ok(allowed > 100);
});

test("with no person to act for, an agent is refused for every tool, before anything runs", async () => {
  const calls: string[] = [];
  const call = serverFor(world({ person: "manage", agent: "manage", actor: "manage" }), callerOf("driver", false), calls);
  for (const t of sample.slice(0, 30)) {
    const r = await call(t.name);
    assert.deepEqual(r, { allowed: false, code: "permission.no_grant" }, `${t.name} ran for an agent with nobody to act for`);
  }
  assert.deepEqual(calls, []);
});

test("the person being suspended or removed stops the connection at once, with the tool's own grants unchanged", async () => {
  const snap = world({ person: "manage", agent: "manage", actor: "manage" });
  const calls: string[] = [];
  const call = serverFor(snap, callerOf("outside"), calls);
  const read = sample.find((t) => t.effects === "read")!;
  assert.equal((await call(read.name)).allowed, true);
  snap.putPrincipal({ id: PERSON, kind: "person", status: "suspended", name: "Dana" });
  const r = await call(read.name);
  assert.equal(r.allowed, false);
  assert.equal(r.code, "permission.suspended");
});

test("scopes narrow on top of access: with every level at manage, a read-only connection still cannot write, post or touch the vault", async () => {
  const snap = world({ person: "manage", agent: null, actor: "manage" });
  const calls: string[] = [];
  const readOnly: McpCaller = { ...callerOf("outside"), scopes: { read: true, post: false, readChangesets: false, writeBranch: false } };
  const call = serverFor(snap, readOnly, calls);
  for (const t of g.catalog.all.filter((x) => g.defaults.has(x.name))) {
    const r = await call(t.name);
    if (r.allowed) assert.equal(t.effects, "read", `${t.name} is not a read tool but ran on a read-only scope`);
    else if (t.effects === "read" && t.local === "none" && !["vault", "terminal", "computer", "engineer"].includes(t.toolset)) assert.fail(`${t.name} is a plain read tool and was refused: ${r.code}`);
  }
  for (const c of calls) assert.equal(g.caps.get(c)!.effects, "read", `${c} reached the pipeline on a read-only scope`);
});

test("the kernel's reason reaches the model as the error code", async () => {
  const calls: string[] = [];
  const call = serverFor(world({ person: "view", agent: "manage", actor: null }), callerOf("driver"), calls);
  const write = sample.find((t) => g.caps.get(t.cap)!.level === "edit")!;
  const r = await call(write.name);
  assert.deepEqual(r, { allowed: false, code: "permission.no_grant" });
});
