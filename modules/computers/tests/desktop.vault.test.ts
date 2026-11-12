// The Vault channel of an older desktop acts for the person whose turn is using it, as the Space browser's does, never for the agent's owner for the computer's whole life: B's turn through an agent
// that A owns is looked up as B (so the team-agent rule decides for B), a token lives only while that person's calls run (an owner change leaves nothing of the old owner's), and with no turn there is no
// channel at all.
import test from "node:test";
import assert from "node:assert/strict";
import { bindFill } from "../projections.ts";
import { createFillService } from "../handlers/fill.ts";
import type { FillLookup } from "../handlers/fill.ts";
import { setFillWait } from "../handlers/tools/common.ts";
import { asPerson, DANA, INTAKE, OMAR } from "../fixtures/harness.ts";
import { tool, world } from "./tools.fixture.ts";

const SECRET = "sk-test-VALUE-0123456789abcdef";
function service() {
  const asked: Array<{ handle: string; asker: string; agentId: string }> = [];
  const svc = createFillService({
    source: { lookup: async (handle, who) => { asked.push({ handle, asker: who.asker, agentId: who.agentId }); return ({ kind: "value", itemId: "vit_x", value: SECRET } satisfies FillLookup); } },
    log: () => undefined,
  });
  const issued: Array<{ asker: string; turn?: boolean; computerId: string }> = [];
  const binding = { issue: async (h: { computerId: string; agentId: string; asker: string; turn?: boolean }) => { issued.push({ asker: h.asker, ...(h.turn ? { turn: true } : {}), computerId: h.computerId }); return svc.issue(h as never); }, url: () => "http://vault.test/fill" };
  return { svc, asked, issued, binding };
}
const ask = (svc: ReturnType<typeof createFillService>, token: string, computerId = "") => svc.serve({ authorization: `Bearer ${token}`, body: { handle: "Stripe", field: "api_key", computerId }, secure: true });
const tokens = (w: Awaited<ReturnType<typeof world>>): string[] => w.h.fake.named("configure").map((c) => (c.args as { fillToken?: string }).fillToken).filter((t): t is string => typeof t === "string");

test("waking an older desktop gives it no Vault channel: nothing acts for its owner between turns", async () => {
  const v = service();
  bindFill(v.binding);
  try {
    const w = await world({ harness: { respond: { "agents.get": (i) => ({ agent: { agentId: i["agentId"], ownerId: DANA, folderId: "fld_x" } }) } } });
    assert.deepEqual(v.issued, [], "no token at wake");
    assert.deepEqual(tokens(w), []);
  } finally { bindFill(null); }
});

test("a turn asked by B on an agent that A owns fills as B, and the token ends with B's call (so does nothing of A's remain)", async () => {
  const v = service();
  bindFill(v.binding);
  try {
    const w = await world({ harness: { respond: { "agents.get": (i) => ({ agent: { agentId: i["agentId"], ownerId: DANA, folderId: "fld_x" } }) } } });
    const b = asPerson(w.h, { kind: "agent", id: INTAKE }, { actingFor: OMAR });
    w.d.rebind();
    await tool["computers.chrome.state"]!(b.ctx, { computerId: w.id });
    assert.deepEqual(v.issued.map((x) => [x.asker, x.turn]), [[OMAR, true]], "one token, for the person whose turn it is");
    const [token] = tokens(w);
    assert.ok(token && token.length >= 16, "agentd was configured with it");
    assert.equal((await ask(v.svc, token!)).status, 401, "it ended with the call");
    // while a call runs the token looks the item up as B, the agent being the one the computer belongs to
    let seenAsker = "";
    w.d.table["chrome_state"] = async () => { const t = tokens(w).at(-1)!; const r = await ask(v.svc, t, w.id); seenAsker = String(v.asked.at(-1)?.asker); void r; return { url: "https://example.com/", title: "x", loading: false }; };
    await tool["computers.chrome.state"]!(b.ctx, { computerId: w.id });
    assert.equal(seenAsker, OMAR, "the Vault is asked as B, not as A who owns the agent");
    assert.deepEqual(v.asked.map((a) => a.agentId), [INTAKE]);
  } finally { bindFill(null); }
});

test("a change of owner leaves nothing of the old owner's authority: after A's turn ends A's token is dead, with no restart", async () => {
  const v = service();
  bindFill(v.binding);
  try {
    const w = await world({ harness: { respond: { "agents.get": (i) => ({ agent: { agentId: i["agentId"], ownerId: DANA, folderId: "fld_x" } }) } } });
    const a = asPerson(w.h, { kind: "agent", id: INTAKE }, { actingFor: DANA });
    w.d.rebind();
    await tool["computers.chrome.state"]!(a.ctx, { computerId: w.id });
    const [tokenA] = tokens(w);
    // agents.set_owner (the agent is now owned by B): the next turn is B's, and A's token cannot do anything
    const b = asPerson(w.h, { kind: "agent", id: INTAKE }, { actingFor: OMAR });
    w.d.rebind();
    await tool["computers.chrome.state"]!(b.ctx, { computerId: w.id });
    assert.equal((await ask(v.svc, tokenA!)).status, 401);
    assert.deepEqual(v.issued.map((x) => x.asker), [DANA, OMAR]);
  } finally { bindFill(null); }
});

test("with no person behind a call there is no Vault channel at all", async () => {
  const v = service();
  bindFill(v.binding);
  try {
    const w = await world();
    const none = asPerson(w.h, { kind: "agent", id: INTAKE });
    w.d.rebind();
    await tool["computers.chrome.state"]!(none.ctx, { computerId: w.id });
    assert.deepEqual(v.issued, []);
    assert.deepEqual(tokens(w), []);
  } finally { bindFill(null); }
});

test("two people at once on one desktop: the second waits, then is told, and never fills with the first one's channel", async () => {
  const v = service();
  bindFill(v.binding);
  setFillWait(60);
  try {
    const w = await world();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    w.d.table["chrome_state"] = async () => { await gate; return { url: "https://example.com/", title: "x", loading: false }; };
    const a = asPerson(w.h, { kind: "agent", id: INTAKE }, { actingFor: DANA });
    const b = asPerson(w.h, { kind: "agent", id: INTAKE }, { actingFor: OMAR });
    w.d.rebind();
    const first = tool["computers.chrome.state"]!(a.ctx, { computerId: w.id });
    await new Promise((r) => setTimeout(r, 20));
    await assert.rejects(() => tool["computers.chrome.state"]!(b.ctx, { computerId: w.id }), (e) => /Someone else's request is using this desktop's Vault channel/.test(JSON.stringify(e)));
    assert.deepEqual(v.issued.map((x) => x.asker), [DANA], "B was never given a channel while A held it, and never used A's");
    release();
    await first;
  } finally { setFillWait(null); bindFill(null); }
});

test("two people whose calls start in the same tick: exactly one holds the channel, the other is told, and nobody fills as the wrong person", async () => {
  const v = service();
  bindFill(v.binding);
  setFillWait(80);
  try {
    const w = await world();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    w.d.table["chrome_state"] = async () => { await gate; return { url: "https://example.com/", title: "x", loading: false }; };
    const a = asPerson(w.h, { kind: "agent", id: INTAKE }, { actingFor: DANA });
    const b = asPerson(w.h, { kind: "agent", id: INTAKE }, { actingFor: OMAR });
    w.d.rebind();
    const both = Promise.allSettled([tool["computers.chrome.state"]!(a.ctx, { computerId: w.id }), tool["computers.chrome.state"]!(b.ctx, { computerId: w.id })]);
    await new Promise((r) => setTimeout(r, 200));
    release();
    const [ra, rb] = await both;
    assert.equal(v.issued.length, 1, "one token for the desktop, not two");
    assert.equal(tokens(w).length, 1, "agentd was configured once, so it holds one person's channel");
    assert.deepEqual([ra!.status, rb!.status].sort(), ["fulfilled", "rejected"], "one call ran with the channel, the other was told");
  } finally { setFillWait(null); bindFill(null); }
});

test("one person, two calls starting together: one token, counted, revoked once when both have ended, and agentd is left with a dead one", async () => {
  const v = service();
  let revokes = 0;
  bindFill({ ...v.binding, issue: async (h) => { const g = await v.binding.issue(h); return { ...g, revoke() { revokes++; g.revoke(); } }; } });
  try {
    const w = await world();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    w.d.table["chrome_state"] = async () => { await gate; return { url: "https://example.com/", title: "x", loading: false }; };
    const a = asPerson(w.h, { kind: "agent", id: INTAKE }, { actingFor: DANA });
    w.d.rebind();
    const both = Promise.all([tool["computers.chrome.state"]!(a.ctx, { computerId: w.id }), tool["computers.chrome.state"]!(a.ctx, { computerId: w.id })]);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(v.issued.length, 1, "one token for two calls");
    release();
    await both;
    assert.equal(revokes, 1, "revoked once, when both ended");
    assert.equal((await ask(v.svc, tokens(w).at(-1)!, w.id)).status, 401, "what agentd holds is dead");
  } finally { bindFill(null); }
});

test("a turn token cannot outlive the call's own time limit: it expires, and a call in use extends it", async () => {
  let t = 1_000_000;
  const svc = createFillService({ source: { lookup: async () => ({ kind: "value", itemId: "vit_x", value: SECRET }) }, log: () => undefined, now: () => t });
  const g = await svc.issue({ computerId: "cmt_1", agentId: INTAKE, asker: DANA, turn: true, ttlMs: 10_000 });
  assert.equal((await ask(svc, g.fillToken, "cmt_1")).status, 200);
  t += 9_000; g.extend!();
  t += 9_000;
  assert.equal((await ask(svc, g.fillToken, "cmt_1")).status, 200, "extended while in use");
  t += 11_000;
  assert.equal((await ask(svc, g.fillToken, "cmt_1")).status, 401, "a missed revoke is never for ever");
});

test("the Space browser's turn tokens expire and extend exactly as the desktop's do: one shared lease", async () => {
  const { grantFor } = await import("../handlers/tools/common.ts");
  const issued: Array<{ ttlMs?: number; turn?: boolean }> = [];
  let extended = 0, revoked = 0;
  const binding = { issue: async (h: { ttlMs?: number; turn?: boolean }) => { issued.push(h); return { fillToken: "t".repeat(48), revoke() { revoked++; }, extend() { extended++; } }; }, url: () => "http://vault.test/fill" };
  const [a, b] = await Promise.all([grantFor(binding as never, "agt_x", "agt_x", DANA), grantFor(binding as never, "agt_x", "agt_x", DANA)]);
  assert.equal(issued.length, 1, "two calls of one person starting together share one token");
  assert.ok(issued[0]!.ttlMs && issued[0]!.ttlMs > 130_000, "the token has an expiry past the tool limit");
  assert.equal(extended, 1, "a call joining extends it");
  a.done(); assert.equal(revoked, 0, "still in use by the other call");
  b.done(); assert.equal(revoked, 1, "revoked once, when both ended");
});

test("a call that joins while the lease is being made is counted, so the first call's end cannot drop the token under it", async () => {
  const { grantFor } = await import("../handlers/tools/common.ts");
  let revoked = 0;
  const binding = { issue: async () => { await new Promise((r) => setTimeout(r, 30)); return { fillToken: "t".repeat(48), revoke() { revoked++; } }; }, url: () => "http://vault.test/fill" };
  const first = grantFor(binding as never, "agt_y", "agt_y", OMAR);
  const joiner = grantFor(binding as never, "agt_y", "agt_y", OMAR);
  (await first).done();
  assert.equal(revoked, 0, "the joiner still holds it");
  const j = await joiner;
  assert.equal(j.token.length, 48);
  j.done();
  assert.equal(revoked, 1);
});
