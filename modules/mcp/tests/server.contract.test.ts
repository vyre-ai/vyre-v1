// The contract of the mcp module against its real handlers (ARCH 12.4: a module goes live only when the contract holds for the handlers, not the stubs): the handler table covers exactly the
// frozen capabilities, each example input is accepted and each answer conforms to its output schema, every error a handler raises is one the capability declares, and every event it emits
// is one it declares, with a payload that matches the frozen event schema.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { handlers } from "../impl.ts";
import { ensure } from "../projections.ts";
import { beginAuthorize, registerClient } from "../oauth.ts";
import { assertEventsConform, codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const mine = registry.capabilities.filter((c) => c.module === "mcp");
const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any> | any>;

test("the handler table covers exactly the capabilities of the mcp manifest", () => {
  assert.equal(mine.length, 17);
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
  const mint = (hn: Harness) => h["mcp.session.mint"]!(hn.ctx, { principal: "agt_a", actingFor: "usr_dana", threadId: "thr_1", traceId: "a".repeat(32) });
  const ORIGIN = "https://acme.vyre.run";
  const asking = (hn: Harness, redirect = "http://127.0.0.1:4100/cb"): string => {
    ensure(hn.db);
    const made = registerClient(hn.db, { client_name: "Claude Code", redirect_uris: [redirect] }, hn.clock.t) as { client: { client_id: string } };
    const b = beginAuthorize(hn.db, { client_id: made.client.client_id, redirect_uri: redirect, response_type: "code", code_challenge: "c".repeat(43), code_challenge_method: "S256" }, ORIGIN, hn.clock.t);
    return (b as { request: { requestId: string } }).request.requestId;
  };
  const agents = (hn: Harness) => ({ ...hn.ctx, call: async (cap: string) => (cap === "agents.outside.connect" ? { agentId: "agt_out", name: "Claude Code" } : cap === "spaces.get" ? { space: { name: "Acme" } } : cap === "agents.get" ? { agent: { name: "Claude Code" } } : { deleted: true }) });
  const allowed = async (hn: Harness) => { await h["mcp.oauth.allow"]!(agents(hn), { requestId: asking(hn) }); return "agt_out"; };
  return [
    { cap: "mcp.oauth.request", run: (hn) => h["mcp.oauth.request"]!(agents(hn), { requestId: asking(hn, "https://tools.example.com/cb") }) },
    { cap: "mcp.oauth.request", run: (hn) => { ensure(hn.db); return h["mcp.oauth.request"]!(agents(hn), { requestId: "oar_none" }); }, expect: "validation.not_found" },
    { cap: "mcp.oauth.request", run: (hn) => { const id = asking(hn); hn.advance(6 * 60_000); return h["mcp.oauth.request"]!(agents(hn), { requestId: id }); }, expect: "auth.expired" },
    { cap: "mcp.oauth.allow", run: (hn) => h["mcp.oauth.allow"]!(agents(hn), { requestId: asking(hn) }) },
    { cap: "mcp.oauth.allow", run: (hn) => { ensure(hn.db); return h["mcp.oauth.allow"]!(agents(hn), { requestId: "oar_none" }); }, expect: "validation.not_found" },
    { cap: "mcp.oauth.allow", run: (hn) => { const id = asking(hn); hn.advance(6 * 60_000); return h["mcp.oauth.allow"]!(agents(hn), { requestId: id }); }, expect: "auth.expired" },
    { cap: "mcp.oauth.allow", run: (hn) => h["mcp.oauth.allow"]!({ ...agents(hn), principal: { kind: "agent", id: "agt_x" }, actingFor: "usr_dana" }, { requestId: asking(hn) }), expect: "permission.no_grant" },
    { cap: "mcp.oauth.decline", run: (hn) => h["mcp.oauth.decline"]!(hn.ctx, { requestId: asking(hn) }) },
    { cap: "mcp.oauth.replayed", run: (hn) => h["mcp.oauth.replayed"]!(hn.ctx, { agentId: "agt_out", person: "usr_dana", why: "A used sign-in came back" }) },
    { cap: "mcp.connected.list", run: async (hn) => { await allowed(hn); return h["mcp.connected.list"]!(hn.ctx, {}); } },
    { cap: "mcp.connected.link", run: (hn) => h["mcp.connected.link"]!(hn.ctx, {}) },
    { cap: "mcp.connected.remove", run: async (hn) => h["mcp.connected.remove"]!(agents(hn), { agentId: await allowed(hn) }) },
    { cap: "mcp.connected.remove", run: (hn) => h["mcp.connected.remove"]!(agents(hn), { agentId: "agt_none" }), expect: "validation.not_found" },
    { cap: "mcp.activity.list", run: async (hn) => h["mcp.activity.list"]!(hn.ctx, { agentId: await allowed(hn) }) },
    { cap: "mcp.activity.list", run: (hn) => h["mcp.activity.list"]!(hn.ctx, { agentId: "agt_none" }), expect: "validation.not_found" },
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
    "mcp.connected.list": ["mcp.client_allowed"], "mcp.connected.remove": ["mcp.client_allowed"], "mcp.activity.list": ["mcp.client_allowed"],
    "mcp.session.close": ["mcp.session_started"], "mcp.sessions.list": ["mcp.session_started"],
  };
  return setup[cap]?.includes(event) ?? false;
}

test("capabilities that make a person-visible change raise their declared events and no others", async () => {
  const hn = harness();
  const m = await h["mcp.session.mint"]!(hn.ctx, { principal: "agt_a", actingFor: "usr_dana", threadId: "thr_1", traceId: "a".repeat(32) });
  h["mcp.session.close"]!(hn.ctx, { sessionId: m.sessionId });
  assert.deepEqual(hn.emitted.map((e) => e.name), ["mcp.session_started", "mcp.session_ended"]);
  assert.deepEqual(assertEventsConform(hn), []);
  const reads = ["mcp.tools.list", "mcp.tool.search", "mcp.tool.describe", "mcp.toolsets.list", "mcp.health", "mcp.sessions.list", "mcp.connected.list", "mcp.connected.link"];
  const before = hn.emitted.length;
  for (const c of reads) await h[c]!(hn.ctx, c === "mcp.tool.search" ? { query: "record" } : c === "mcp.tool.describe" ? { names: ["records_get"] } : {});
  assert.equal(hn.emitted.length, before, "reads emit nothing");
});
