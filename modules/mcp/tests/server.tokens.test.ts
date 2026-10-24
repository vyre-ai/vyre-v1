// Tokens and sessions of the MCP server (spec 2.2, 4.12; ARCH 6.7): a one-time token works once and within 10 minutes, the credential it becomes is shown once and kept only as a hash,
// scopes change, a revoked actor stops, and the loopback session of a CLI engine carries principal, person, thread, run and trace. Real SQLite; every answer and event checked against the frozen contract.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { revokeActor, tokenBy, sha256, callerForToken, bindEndpoint, bindEngineerCheck } from "../projections.ts";
import { assertEventsConform, codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any> | any>;
const call = async (hn: Harness, cap: string, input: unknown, ctx: Harness["ctx"] = hn.ctx): Promise<any> => {
  assert.deepEqual(contractErrors(cap, "in", input), [], `${cap} input`);
  const out = await h[cap]!(ctx, input);
  assert.deepEqual(contractErrors(cap, "out", out), [], `${cap} output`);
  return out;
};
let keys = 0;
const idem = (): string => `idem_${++keys}`;
const rejects = async (p: Promise<unknown>): Promise<string> => { try { await p; } catch (e) { return codeOf(e); } return "no error"; };

async function connect(hn: Harness, scopes?: { read: boolean; post: boolean; readChangesets: boolean; writeBranch: boolean }) {
  const issued = await call(hn, "mcp.token.issue", { name: "Claude Code", kind: "claude_code", idempotencyKey: idem(), ...(scopes ? { scopes } : {}) });
  const reg = await call(hn, "mcp.token.register", { oneTimeToken: issued.oneTimeToken, clientName: "claude-code", clientVersion: "2.1" }, hn.as({ kind: "service", id: "anonymous" }));
  return { issued, reg };
}

test("issue: a token that works once, within 10 minutes, shown with the address to connect to", async () => {
  const hn = harness();
  bindEndpoint({ url: "https://northwind.example.com/mcp", loopbackUrl: "http://127.0.0.1:41800/mcp" });
  const out = await call(hn, "mcp.token.issue", { name: "Claude Code", kind: "claude_code", idempotencyKey: idem() });
  assert.equal(out.expiresAt, hn.clock.t + 10 * 60_000);
  assert.equal(out.mcpUrl, "https://northwind.example.com/mcp");
  assert.match(out.oneTimeToken, /^otk_[0-9a-f]{48}$/);
  assert.match(out.tokenId, /^tok_[a-z0-9]+$/);
  const issued = hn.named("token.issued");
  assert.equal(issued.length, 1);
  assert.deepEqual(issued[0]?.payload, { tokenId: out.tokenId, name: "Claude Code", kind: "claude_code", by: "usr_dana", expiresAt: out.expiresAt });
  assert.equal(JSON.stringify(issued[0]).includes(out.oneTimeToken), false, "the event never carries the token");
  const row = hn.rows("SELECT * FROM mcp_tokens")[0]!;
  assert.equal(row["token_hash"], await sha256(out.oneTimeToken));
  assert.equal(JSON.stringify(row).includes(out.oneTimeToken), false, "only the hash is stored");
  assert.deepEqual(assertEventsConform(hn), []);
  bindEndpoint(null);
});

test("issue: scopes default to read, post and changesets with branch writes off; names and kinds are checked", async () => {
  const hn = harness();
  const out = await call(hn, "mcp.token.issue", { name: "  Codex  ", kind: "codex", idempotencyKey: idem() });
  const row = tokenBy(hn.db, "token_id", out.tokenId)!;
  assert.deepEqual(row.scopes, { read: true, post: true, readChangesets: true, writeBranch: false });
  assert.equal(row.name, "Codex");
  assert.equal(await rejects(h["mcp.token.issue"]!(hn.ctx, { name: "   ", kind: "codex", idempotencyKey: idem() })), "validation.bad_input");
  assert.equal(await rejects(h["mcp.token.issue"]!(hn.ctx, { name: "x", kind: "vim", idempotencyKey: idem() })), "validation.bad_input");
});

test("register: the one-time token becomes a credential, once; a second try, a wrong token and an expired one are refused alike", async () => {
  const hn = harness();
  const { issued, reg } = await connect(hn);
  assert.match(reg.actorId, /^act_[a-z0-9]+$/);
  assert.match(reg.token, /^vyr_[0-9a-f]{48}$/);
  assert.deepEqual(reg.scopes, { read: true, post: true, readChangesets: true, writeBranch: false });
  const registered = hn.named("token.registered");
  assert.deepEqual(registered[0]?.payload, { tokenId: issued.tokenId, actorId: reg.actorId, name: "Claude Code", scopes: reg.scopes });
  assert.equal(JSON.stringify(registered[0]).includes(reg.token), false);
  const row = tokenBy(hn.db, "token_id", issued.tokenId)!;
  assert.equal(row.state, "registered");
  assert.equal(row.credHash, await sha256(reg.token));
  assert.equal(JSON.stringify(hn.rows("SELECT * FROM mcp_tokens")).includes(reg.token), false, "the credential is stored only as a hash");

  assert.equal(await rejects(h["mcp.token.register"]!(hn.ctx, { oneTimeToken: issued.oneTimeToken, clientName: "again" })), "auth.invalid_code", "works once");
  assert.equal(await rejects(h["mcp.token.register"]!(hn.ctx, { oneTimeToken: "otk_nope", clientName: "x" })), "auth.invalid_code");
  assert.equal(await rejects(h["mcp.token.register"]!(hn.ctx, { oneTimeToken: reg.token, clientName: "x" })), "auth.invalid_code", "the credential is not a registration token");
  assert.deepEqual(assertEventsConform(hn), []);

  const late = await call(hn, "mcp.token.issue", { name: "Late", kind: "other", idempotencyKey: idem() });
  hn.advance(10 * 60_000 + 1);
  assert.equal(await rejects(h["mcp.token.register"]!(hn.ctx, { oneTimeToken: late.oneTimeToken, clientName: "x" })), "auth.expired");
});

test("register one millisecond before the window closes works; at the closing instant it does not", async () => {
  const hn = harness();
  const a = await call(hn, "mcp.token.issue", { name: "A", kind: "other", idempotencyKey: idem() });
  hn.advance(10 * 60_000 - 1);
  await call(hn, "mcp.token.register", { oneTimeToken: a.oneTimeToken, clientName: "x" });
  const b = await call(hn, "mcp.token.issue", { name: "B", kind: "other", idempotencyKey: idem() });
  hn.advance(10 * 60_000);
  assert.equal(await rejects(h["mcp.token.register"]!(hn.ctx, { oneTimeToken: b.oneTimeToken, clientName: "x" })), "auth.expired");
});

test("log_reveal: only the person who made the token, or someone who manages agents, can log that it was shown", async () => {
  const hn = harness();
  const issued = await call(hn, "mcp.token.issue", { name: "Claude Code", kind: "claude_code", idempotencyKey: idem() });
  assert.deepEqual(await call(hn, "mcp.token.log_reveal", { tokenId: issued.tokenId, action: "reveal" }), { ok: true });
  assert.deepEqual(await call(hn, "mcp.token.log_reveal", { tokenId: issued.tokenId, action: "copy" }), { ok: true });
  assert.deepEqual(hn.named("token.revealed").map((e) => e.payload["action"]), ["reveal", "copy"]);
  assert.equal(tokenBy(hn.db, "token_id", issued.tokenId)?.reveals, 2);
  assert.equal(await rejects(h["mcp.token.log_reveal"]!(hn.ctx, { tokenId: "tok_missing", action: "copy" })), "validation.bad_input");

  hn.allowOnly(() => false);
  const other = hn.as({ kind: "person", id: "usr_ravi" });
  assert.equal(await rejects(h["mcp.token.log_reveal"]!(other, { tokenId: issued.tokenId, action: "reveal" })), "permission.no_grant");
  hn.allowOnly(() => true);
  assert.deepEqual(await call(hn, "mcp.token.log_reveal", { tokenId: issued.tokenId, action: "reveal" }, other), { ok: true });
  assert.deepEqual(assertEventsConform(hn), []);
});

test("session.open: the credential opens a session for the actor acting for the person who made the token", async () => {
  const hn = harness();
  const { reg } = await connect(hn, { read: true, post: false, readChangesets: false, writeBranch: false });
  const anon = hn.as({ kind: "service", id: "anonymous" });
  const out = await call(hn, "mcp.session.open", { token: reg.token, clientName: "claude-code" }, anon);
  assert.equal(out.principal, reg.actorId);
  assert.equal(out.actingFor, "usr_dana");
  assert.deepEqual(out.scopes, { read: true, post: false, readChangesets: false, writeBranch: false });
  assert.ok(!out.toolsets.includes("engineer"), "no engineer toolset without engineer.mcp");
  assert.ok(!out.toolsets.includes("vault") && !out.toolsets.includes("terminal") && !out.toolsets.includes("computer"), "never for an outside tool");
  assert.ok(out.toolsets.includes("records") && out.toolsets.includes("meta"));
  assert.deepEqual(hn.named("mcp.session_started")[0]?.payload, { sessionId: out.sessionId, kind: "outside", principal: reg.actorId, actingFor: "usr_dana" });
  assert.deepEqual(assertEventsConform(hn), []);
  const caller = await callerForToken(hn.db, hn.ctx.space, reg.token, hn.clock.t);
  assert.ok("caller" in caller);
  if ("caller" in caller) {
    assert.deepEqual(caller.caller.principal, { kind: "actor", id: reg.actorId });
    assert.equal(caller.caller.kind, "outside");
  }
});

test("session.open: the engineer toolset is listed only when access says the actor holds engineer.mcp (fails closed)", async () => {
  const hn = harness();
  const { reg } = await connect(hn);
  const anon = hn.as({ kind: "service", id: "anonymous" });
  const without = await call(hn, "mcp.session.open", { token: reg.token }, anon);
  assert.ok(!without.toolsets.includes("engineer"), "no check bound: closed");
  bindEngineerCheck((id) => id === reg.actorId);
  const withIt = await call(hn, "mcp.session.open", { token: reg.token }, anon);
  bindEngineerCheck(null);
  assert.ok(withIt.toolsets.includes("engineer"));
  const other = await call(hn, "mcp.session.open", { token: (await connect(hn)).reg.token }, anon);
  assert.ok(!other.toolsets.includes("engineer"), "bound to one actor only");
});

test("session.open: unknown, expired and revoked tokens are refused with their own codes", async () => {
  const hn = harness();
  const { issued, reg } = await connect(hn);
  const anon = hn.as({ kind: "service", id: "anonymous" });
  assert.equal(await rejects(h["mcp.session.open"]!(anon, { token: "vyr_unknown" })), "auth.unauthenticated");
  assert.equal(await rejects(h["mcp.session.open"]!(anon, { token: issued.oneTimeToken })), "auth.unauthenticated", "the registration token is not a session token");
  revokeActor(hn.db, reg.actorId, hn.clock.t);
  assert.equal(await rejects(h["mcp.session.open"]!(anon, { token: reg.token })), "permission.revoked");
});

test("scopes.set: changes the actor's scopes, for its open sessions too; unknown and revoked actors are refused", async () => {
  const hn = harness();
  const { reg } = await connect(hn);
  const anon = hn.as({ kind: "service", id: "anonymous" });
  const opened = await call(hn, "mcp.session.open", { token: reg.token }, anon);
  const narrow = { read: true, post: false, readChangesets: false, writeBranch: false };
  assert.deepEqual((await call(hn, "mcp.scopes.set", { actorId: reg.actorId, scopes: narrow })).scopes, narrow);
  assert.deepEqual(hn.named("mcp.scopes_changed")[0]?.payload, { actorId: reg.actorId, by: "usr_dana" });
  const session = hn.rows("SELECT scopes FROM mcp_sessions WHERE session_id = ?", opened.sessionId)[0]!;
  assert.deepEqual(JSON.parse(String(session["scopes"])), narrow);
  assert.equal(await rejects(h["mcp.scopes.set"]!(hn.ctx, { actorId: "act_missing", scopes: narrow })), "validation.bad_input");
  revokeActor(hn.db, reg.actorId, hn.clock.t);
  assert.equal(await rejects(h["mcp.scopes.set"]!(hn.ctx, { actorId: reg.actorId, scopes: narrow })), "permission.no_grant");
  assert.deepEqual(assertEventsConform(hn), []);
});

test("revoking the actor closes its sessions and stops its credential", async () => {
  const hn = harness();
  const { reg } = await connect(hn);
  const anon = hn.as({ kind: "service", id: "anonymous" });
  const a = await call(hn, "mcp.session.open", { token: reg.token }, anon);
  const b = await call(hn, "mcp.session.open", { token: reg.token }, anon);
  assert.notEqual(a.sessionId, b.sessionId);
  const ended = revokeActor(hn.db, reg.actorId, hn.clock.t);
  assert.deepEqual(ended.sort(), [a.sessionId, b.sessionId].sort());
  assert.equal(hn.rows("SELECT COUNT(*) AS n FROM mcp_sessions WHERE closed_at IS NULL")[0]!["n"], 0);
  const r = await callerForToken(hn.db, hn.ctx.space, reg.token, hn.clock.t);
  assert.deepEqual(r, { refused: "revoked" });
});

test("mint: a CLI engine's loopback session carries principal, person, thread, run and trace, and expires", async () => {
  const hn = harness();
  const out = await call(hn, "mcp.session.mint", { principal: "agt_intake", actingFor: "usr_dana", threadId: "thr_intake", runId: "run_1", traceId: "11111111111111112222222222222222", ttlSec: 120 });
  assert.match(out.sessionToken, /^vys_[0-9a-f]{48}$/);
  assert.equal(out.url, "http://127.0.0.1:41800/mcp");
  assert.equal(out.expiresAt, hn.clock.t + 120_000);
  assert.deepEqual(hn.named("mcp.session_started")[0]?.payload, { sessionId: out.sessionId, kind: "driver", principal: "agt_intake", actingFor: "usr_dana", threadId: "thr_intake" });
  assert.equal(JSON.stringify(hn.rows("SELECT * FROM mcp_sessions")).includes(out.sessionToken), false, "only the hash is stored");

  const opened = await call(hn, "mcp.session.open", { token: out.sessionToken }, hn.as({ kind: "service", id: "anonymous" }));
  assert.equal(opened.sessionId, out.sessionId, "opening a minted token finds the session minted for it");
  assert.equal(hn.named("mcp.session_started").length, 1, "and does not start a second one");
  const r = await callerForToken(hn.db, hn.ctx.space, out.sessionToken, hn.clock.t);
  assert.ok("caller" in r);
  if ("caller" in r) {
    assert.deepEqual(r.caller, {
      kind: "driver", sessionId: out.sessionId, space: hn.ctx.space, principal: { kind: "agent", id: "agt_intake" }, actingFor: "usr_dana",
      threadId: "thr_intake", runId: "run_1", traceId: "11111111111111112222222222222222",
    });
  }
  hn.advance(120_001);
  assert.equal(await rejects(h["mcp.session.open"]!(hn.as({ kind: "service", id: "anonymous" }), { token: out.sessionToken })), "auth.expired");
  assert.deepEqual(assertEventsConform(hn), []);
});

test("mint: the lifetime is held between a minute and a day", async () => {
  const hn = harness();
  const short = await call(hn, "mcp.session.mint", { principal: "agt_a", actingFor: "usr_dana", threadId: "thr_1", traceId: "a".repeat(32), ttlSec: 60 });
  const day = await call(hn, "mcp.session.mint", { principal: "agt_a", actingFor: "usr_dana", threadId: "thr_1", traceId: "a".repeat(32), ttlSec: 86_400 });
  const dflt = await call(hn, "mcp.session.mint", { principal: "agt_a", actingFor: "usr_dana", threadId: "thr_1", traceId: "a".repeat(32) });
  assert.equal(short.expiresAt - hn.clock.t, 60_000);
  assert.equal(day.expiresAt - hn.clock.t, 86_400_000);
  assert.equal(dflt.expiresAt - hn.clock.t, 6 * 3600_000);
});

test("close: ends a session once, idempotently, and says so in an event", async () => {
  const hn = harness();
  const out = await call(hn, "mcp.session.mint", { principal: "agt_a", actingFor: "usr_dana", threadId: "thr_1", traceId: "a".repeat(32) });
  assert.deepEqual(await call(hn, "mcp.session.close", { sessionId: out.sessionId }), { closed: true });
  assert.deepEqual(await call(hn, "mcp.session.close", { sessionId: out.sessionId }), { closed: true });
  assert.equal(hn.named("mcp.session_ended").length, 1);
  assert.deepEqual(hn.named("mcp.session_ended")[0]?.payload, { sessionId: out.sessionId, calls: 0 });
  assert.equal(await rejects(h["mcp.session.close"]!(hn.ctx, { sessionId: "ses_missing" })), "validation.bad_input");
  const again = await callerForToken(hn.db, hn.ctx.space, out.sessionToken, hn.clock.t);
  assert.deepEqual(again, { refused: "revoked" });
  assert.deepEqual(assertEventsConform(hn), []);
});

test("sessions.list: newest first, filtered by kind, paged", async () => {
  const hn = harness();
  for (let i = 0; i < 5; i++) { hn.advance(1000); await call(hn, "mcp.session.mint", { principal: `agt_${i}`, actingFor: "usr_dana", threadId: "thr_1", traceId: "a".repeat(32) }); }
  const { reg } = await connect(hn);
  hn.advance(1000);
  await call(hn, "mcp.session.open", { token: reg.token }, hn.as({ kind: "service", id: "anonymous" }));
  const all = await call(hn, "mcp.sessions.list", {});
  assert.equal(all.total, 6);
  assert.equal(all.sessions[0].kind, "outside", "the newest session is first");
  const drivers = await call(hn, "mcp.sessions.list", { kind: "driver", limit: 2 });
  assert.equal(drivers.total, 5);
  assert.equal(drivers.sessions.length, 2);
  assert.equal(drivers.next, "2");
  const rest = await call(hn, "mcp.sessions.list", { kind: "driver", limit: 2, cursor: drivers.next });
  assert.deepEqual([rest.sessions.length, rest.next], [2, "4"]);
  const last = await call(hn, "mcp.sessions.list", { kind: "driver", limit: 2, cursor: rest.next });
  assert.deepEqual([last.sessions.length, last.next], [1, undefined]);
  assert.equal(drivers.sessions[0].principal, "agt_4");
});
