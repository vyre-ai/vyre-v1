// Sessions of the MCP server (spec 2.2, 4.12; ARCH 6.7): the loopback session of a CLI engine carries principal, person, thread, run and trace. Real SQLite; every answer and event checked against the frozen contract.
// An outside agent's sign-in is in oauth.protocol.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { driverForToken, insertSession, mintId } from "../projections.ts";
import { assertEventsConform, codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any> | any>;
const call = async (hn: Harness, cap: string, input: unknown, ctx: Harness["ctx"] = hn.ctx): Promise<any> => {
  assert.deepEqual(contractErrors(cap, "in", input), [], `${cap} input`);
  const out = await h[cap]!(ctx, input);
  assert.deepEqual(contractErrors(cap, "out", out), [], `${cap} output`);
  return out;
};
const rejects = async (f: () => unknown): Promise<string> => { try { await f(); } catch (e) { return codeOf(e); } return "no error"; };

test("mint: a CLI engine's loopback session carries principal, person, thread, run and trace, and expires", async () => {
  const hn = harness();
  const out = await call(hn, "mcp.session.mint", { principal: "agt_intake", actingFor: "usr_dana", threadId: "thr_intake", runId: "run_1", traceId: "11111111111111112222222222222222", ttlSec: 120 });
  assert.match(out.sessionToken, /^vys_[0-9a-f]{48}$/);
  assert.equal(out.url, "http://127.0.0.1:41800/mcp");
  assert.equal(out.expiresAt, hn.clock.t + 120_000);
  assert.deepEqual(hn.named("mcp.session_started")[0]?.payload, { sessionId: out.sessionId, kind: "driver", principal: "agt_intake", actingFor: "usr_dana", threadId: "thr_intake" });
  assert.equal(JSON.stringify(hn.rows("SELECT * FROM mcp_sessions")).includes(out.sessionToken), false, "only the hash is stored");

  const r = await driverForToken(hn.db, hn.ctx.space, out.sessionToken, hn.clock.t);
  assert.ok("caller" in r);
  if ("caller" in r) {
    assert.deepEqual(r.caller, {
      kind: "driver", sessionId: out.sessionId, space: hn.ctx.space, principal: { kind: "agent", id: "agt_intake" }, actingFor: "usr_dana",
      threadId: "thr_intake", runId: "run_1", traceId: "11111111111111112222222222222222",
    });
  }
  hn.advance(120_001);
  assert.deepEqual(await driverForToken(hn.db, hn.ctx.space, out.sessionToken, hn.clock.t), { refused: "expired" });
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
  assert.equal(await rejects(() => h["mcp.session.close"]!(hn.ctx, { sessionId: "ses_missing" })), "validation.bad_input");
  const again = await driverForToken(hn.db, hn.ctx.space, out.sessionToken, hn.clock.t);
  assert.deepEqual(again, { refused: "revoked" });
  assert.deepEqual(assertEventsConform(hn), []);
});

test("sessions.list: newest first, filtered by kind, paged", async () => {
  const hn = harness();
  for (let i = 0; i < 5; i++) { hn.advance(1000); await call(hn, "mcp.session.mint", { principal: `agt_${i}`, actingFor: "usr_dana", threadId: "thr_1", traceId: "a".repeat(32) }); }
  hn.advance(1000);
  insertSession(hn.db, { sessionId: mintId("ses", hn.clock.t), kind: "outside", principal: "agt_out", actingFor: "usr_dana", startedAt: hn.clock.t, calls: 0 });
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

test("sessions.list retains closed and expiry timestamps so recent sessions cannot appear open", async () => {
 const hn=harness();const session=await call(hn,"mcp.session.mint",{principal:"agt_a",actingFor:"usr_dana",threadId:"thr_1",traceId:"a".repeat(32),ttlSec:60});
 await call(hn,"mcp.session.close",{sessionId:session.sessionId});
 const out=await call(hn,"mcp.sessions.list",{});const row=out.sessions.find((item:{sessionId:string})=>item.sessionId===session.sessionId);
 assert.equal(row.closedAt,hn.clock.t);assert.equal(row.expiresAt,session.expiresAt);
 assert.equal('tokenHash' in row,false);assert.equal('sessionToken' in row,false);
});
