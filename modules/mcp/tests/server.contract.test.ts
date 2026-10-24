// The contract of the mcp module against its real handlers (ARCH 12.4: a module goes live only when the contract holds for the handlers, not the stubs): the handler table covers exactly the
// frozen capabilities, each example input is accepted and each answer conforms to its output schema, every error a handler raises is one the capability declares, and every event it emits
// is one it declares, with a payload that matches the frozen event schema.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { handlers } from "../impl.ts";
import { revokeActor } from "../projections.ts";
import { assertEventsConform, codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const mine = registry.capabilities.filter((c) => c.module === "mcp");
const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any> | any>;

test("the handler table covers exactly the capabilities of the mcp manifest", () => {
  assert.equal(mine.length, 13);
  assert.deepEqual(Object.keys(h).sort(), mine.map((c) => c.name).sort());
  for (const c of mine) assert.equal(typeof h[c.name], "function", c.name);
});

test("each read capability answers its own example input with an answer that matches its output schema", async () => {
  for (const name of ["mcp.health", "mcp.toolsets.list", "mcp.tools.list", "mcp.tool.search", "mcp.tool.describe", "mcp.sessions.list"]) {
    const cap = mine.find((c) => c.name === name)!;
    const hn = harness();
    for (const ex of cap.examples) {
      assert.deepEqual(contractErrors(name, "in", ex.input), [], `${name}: example input`);
      const out = await h[name]!(hn.ctx, ex.input);
      assert.deepEqual(contractErrors(name, "out", out), [], `${name}: answer to example ${ex.name}`);
    }
  }
});

interface Scenario { cap: string; run: (hn: Harness) => Promise<unknown> | unknown; expect?: string }

/** A path through each capability, happy and unhappy, with the code the unhappy ones must raise. */
function scenarios(): Scenario[] {
  const anon = (hn: Harness) => hn.as({ kind: "service", id: "anonymous" });
  let n = 0;
  const issue = (hn: Harness) => h["mcp.token.issue"]!(hn.ctx, { name: "Claude Code", kind: "claude_code", idempotencyKey: `k${++n}` });
  const register = async (hn: Harness) => h["mcp.token.register"]!(anon(hn), { oneTimeToken: (await issue(hn)).oneTimeToken, clientName: "cc" });
  const mint = (hn: Harness) => h["mcp.session.mint"]!(hn.ctx, { principal: "agt_a", actingFor: "usr_dana", threadId: "thr_1", traceId: "a".repeat(32) });
  return [
    { cap: "mcp.token.issue", run: issue },
    { cap: "mcp.token.issue", run: (hn) => h["mcp.token.issue"]!(hn.ctx, { name: " ", kind: "codex", idempotencyKey: "k0" }), expect: "validation.bad_input" },
    { cap: "mcp.token.register", run: register },
    { cap: "mcp.token.register", run: (hn) => h["mcp.token.register"]!(anon(hn), { oneTimeToken: "otk_x", clientName: "x" }), expect: "auth.invalid_code" },
    { cap: "mcp.token.register", run: async (hn) => { const t = await issue(hn); hn.advance(11 * 60_000); return h["mcp.token.register"]!(anon(hn), { oneTimeToken: t.oneTimeToken, clientName: "x" }); }, expect: "auth.expired" },
    { cap: "mcp.token.log_reveal", run: async (hn) => h["mcp.token.log_reveal"]!(hn.ctx, { tokenId: (await issue(hn)).tokenId, action: "reveal" }) },
    { cap: "mcp.token.log_reveal", run: (hn) => h["mcp.token.log_reveal"]!(hn.ctx, { tokenId: "tok_none", action: "copy" }), expect: "validation.bad_input" },
    { cap: "mcp.scopes.set", run: async (hn) => h["mcp.scopes.set"]!(hn.ctx, { actorId: (await register(hn)).actorId, scopes: { read: true, post: false, readChangesets: false, writeBranch: false } }) },
    { cap: "mcp.scopes.set", run: (hn) => h["mcp.scopes.set"]!(hn.ctx, { actorId: "act_none", scopes: { read: true, post: true, readChangesets: true, writeBranch: false } }), expect: "validation.bad_input" },
    { cap: "mcp.scopes.set", run: async (hn) => { const r = await register(hn); revokeActor(hn.db, r.actorId, hn.clock.t); return h["mcp.scopes.set"]!(hn.ctx, { actorId: r.actorId, scopes: { read: true, post: true, readChangesets: true, writeBranch: false } }); }, expect: "permission.no_grant" },
    { cap: "mcp.session.open", run: async (hn) => h["mcp.session.open"]!(anon(hn), { token: (await register(hn)).token }) },
    { cap: "mcp.session.open", run: async (hn) => h["mcp.session.open"]!(anon(hn), { token: (await mint(hn)).sessionToken }) },
    { cap: "mcp.session.open", run: (hn) => h["mcp.session.open"]!(anon(hn), { token: "vyr_none" }), expect: "auth.unauthenticated" },
    { cap: "mcp.session.open", run: async (hn) => { const m = await mint(hn); hn.advance(7 * 3600_000); return h["mcp.session.open"]!(anon(hn), { token: m.sessionToken }); }, expect: "auth.expired" },
    { cap: "mcp.session.open", run: async (hn) => { const r = await register(hn); revokeActor(hn.db, r.actorId, hn.clock.t); return h["mcp.session.open"]!(anon(hn), { token: r.token }); }, expect: "permission.revoked" },
    { cap: "mcp.session.mint", run: mint },
    { cap: "mcp.session.close", run: async (hn) => h["mcp.session.close"]!(hn.ctx, { sessionId: (await mint(hn)).sessionId }) },
    { cap: "mcp.session.close", run: (hn) => h["mcp.session.close"]!(hn.ctx, { sessionId: "ses_none" }), expect: "validation.bad_input" },
    { cap: "mcp.sessions.list", run: async (hn) => { await mint(hn); return h["mcp.sessions.list"]!(hn.ctx, {}); } },
    { cap: "mcp.tools.list", run: (hn) => h["mcp.tools.list"]!(hn.ctx, { includeDeferred: true }) },
    { cap: "mcp.tool.search", run: (hn) => h["mcp.tool.search"]!(hn.ctx, { query: "record", limit: 3 }) },
    { cap: "mcp.tool.describe", run: (hn) => h["mcp.tool.describe"]!(hn.ctx, { names: ["records_query"] }) },
    { cap: "mcp.toolsets.list", run: (hn) => h["mcp.toolsets.list"]!(hn.ctx, {}) },
    { cap: "mcp.health", run: (hn) => h["mcp.health"]!(hn.ctx, {}) },
  ];
}

test("every path through every capability: answers match the schema, errors are declared, events are declared and match their schemas", async () => {
  let happy = 0, unhappy = 0;
  for (const s of scenarios()) {
    const cap = mine.find((c) => c.name === s.cap)!;
    const hn = harness();
    let out: unknown;
    let code: string | null = null;
    try { out = await s.run(hn); } catch (e) { code = codeOf(e); }
    if (s.expect !== undefined) {
      unhappy++;
      assert.equal(code, s.expect, `${s.cap}: expected ${s.expect}`);
      assert.ok((cap.errors as readonly string[]).includes(s.expect), `${s.cap} does not declare ${s.expect}`);
    } else {
      happy++;
      assert.equal(code, null, `${s.cap} raised ${String(code)}`);
      assert.deepEqual(contractErrors(s.cap, "out", out), [], `${s.cap}: answer`);
    }
    for (const e of hn.emitted) assert.ok((cap.emits as readonly string[]).includes(e.name) || scenarioEmitsOther(s.cap, e.name), `${s.cap} emitted undeclared ${e.name}`);
    assert.deepEqual(assertEventsConform(hn), [], s.cap);
  }
  assert.ok(happy >= 13 && unhappy >= 8, `${happy} happy, ${unhappy} unhappy`);
});

/** Scenarios that call other capabilities to set up (issue, register, mint) emit those capabilities' events too. */
function scenarioEmitsOther(cap: string, event: string): boolean {
  const setup: Record<string, string[]> = {
    "mcp.token.register": ["token.issued"], "mcp.token.log_reveal": ["token.issued"], "mcp.scopes.set": ["token.issued", "token.registered"],
    "mcp.session.open": ["token.issued", "token.registered", "mcp.session_started"], "mcp.session.close": ["mcp.session_started"], "mcp.sessions.list": ["mcp.session_started"],
  };
  return setup[cap]?.includes(event) ?? false;
}

test("capabilities that make a person-visible change raise their declared events and no others", async () => {
  const hn = harness();
  const t = await h["mcp.token.issue"]!(hn.ctx, { name: "Codex", kind: "codex", idempotencyKey: "k1" });
  const r = await h["mcp.token.register"]!(hn.as({ kind: "service", id: "anonymous" }), { oneTimeToken: t.oneTimeToken, clientName: "codex" });
  await h["mcp.scopes.set"]!(hn.ctx, { actorId: r.actorId, scopes: { read: true, post: true, readChangesets: true, writeBranch: false } });
  await h["mcp.token.log_reveal"]!(hn.ctx, { tokenId: t.tokenId, action: "copy" });
  const m = await h["mcp.session.mint"]!(hn.ctx, { principal: "agt_a", actingFor: "usr_dana", threadId: "thr_1", traceId: "a".repeat(32) });
  h["mcp.session.close"]!(hn.ctx, { sessionId: m.sessionId });
  assert.deepEqual(hn.emitted.map((e) => e.name), ["token.issued", "token.registered", "mcp.scopes_changed", "token.revealed", "mcp.session_started", "mcp.session_ended"]);
  assert.deepEqual(assertEventsConform(hn), []);
  const reads = ["mcp.tools.list", "mcp.tool.search", "mcp.tool.describe", "mcp.toolsets.list", "mcp.health", "mcp.sessions.list"];
  const before = hn.emitted.length;
  for (const c of reads) await h[c]!(hn.ctx, c === "mcp.tool.search" ? { query: "record" } : c === "mcp.tool.describe" ? { names: ["records_get"] } : {});
  assert.equal(hn.emitted.length, before, "reads emit nothing");
});
