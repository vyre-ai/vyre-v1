// campaigns warmup client (spec 2.19; ARCH 7.6, R19): join and exchange are signed by the Space key and say what the pool contract says; a Space that opted out warms up with its own
// seed inboxes and never contacts the pool; a Space that opted in sends only to the peers the pool gives it, within the day's ramp, and reports health back into warmup.status.
// The pool is a scripted stand-in that checks every signature with the public key against the documented bytes (relay/warmup/wire.js), so the client and the service agree without
// the module importing the service. @reads keeps ci-select on this test.
// @reads /modules/campaigns/migrations/0001_campaigns.sql

import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { configureWarmup, poolExchange, poolJoin, runWarmupPass, signedBytes, signedHeaders } from "../handlers/warmup.ts";
import type { PoolHttp, PoolResponse, PoolSigner, WarmupConfig } from "../handlers/warmup.ts";
import { DAY, NOW, harness } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";
import { run } from "../fixtures/seed.ts";

const subtle = globalThis.crypto.subtle;
const unb64 = (t: string): Uint8Array => Uint8Array.from(atob(t.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
const b64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

const pair = await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const PUB = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
const signer: PoolSigner = { publicKey: PUB, sign: async (m) => new Uint8Array(await subtle.sign({ name: "Ed25519" }, pair.privateKey, m as BufferSource)) };

interface Req { url: string; path: string; method: string; headers: Record<string, string>; body: any; text: string; verified: boolean }   // eslint-disable-line @typescript-eslint/no-explicit-any

/** A pool stand-in: verifies each request's signature the way the service does, records it, and answers from a script. */
class FakePool {
  requests: Req[] = [];
  /** peers to hand out per mailbox address; health rows by address */
  peers: Record<string, string[]> = {};
  health: Record<string, Partial<{ reports: number; spamRate: number; replyRate: number; missingRate: number; slow: boolean }>> = {};
  fail: { status: number; code: string; retryAfterMs?: number } | null = null;
  down = false;
  /** the next join call fails with this status */
  joinFail: number | null = null;
  /** hand out every peer in the script whatever was asked, as a misbehaving pool would */
  ignoreWant = false;

  http: PoolHttp = async (url, init) => {
    if (this.down) throw new Error("connection refused");
    const u = new URL(url);
    const h = Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v]));
    const msg = signedBytes(init.method, u.pathname, h["x-vyre-ts"]!, h["x-vyre-nonce"]!, init.body);
    const key = await subtle.importKey("raw", unb64(h["x-vyre-key"]!) as BufferSource, { name: "Ed25519" }, false, ["verify"]);
    const verified = await subtle.verify({ name: "Ed25519" }, key, unb64(h["x-vyre-sig"]!) as BufferSource, msg as BufferSource);
    const req: Req = { url, path: u.pathname, method: init.method, headers: h, body: JSON.parse(init.body), text: init.body, verified };
    this.requests.push(req);
    const reply = (status: number, body: unknown): PoolResponse => ({ status, ok: status >= 200 && status < 300, json: async () => body });
    if (!verified) return reply(401, { error: { code: "auth.invalid_signature", message: "no" } });
    if (this.fail) return reply(this.fail.status, { error: { code: this.fail.code, message: "refused", ...(this.fail.retryAfterMs ? { retryAfterMs: this.fail.retryAfterMs } : {}) } });
    if (u.pathname === "/v1/pool/join") {
      if (this.joinFail !== null) return reply(this.joinFail, { error: { code: "internal.unexpected", message: "down" } });
      return reply(200, { data: { joined: req.body.mailboxes.length, left: req.body.mailboxes.length === 0, pool: { spaces: 1, mailboxes: req.body.mailboxes.length } } });
    }
    if (u.pathname === "/v1/pool/exchange") {
      const mailboxes = req.body.mailboxes as { address: string; want: number }[];
      return reply(200, { data: {
        assignments: mailboxes.map((m) => ({ address: m.address, peers: this.ignoreWant ? (this.peers[m.address] ?? []) : (this.peers[m.address] ?? []).slice(0, m.want) })),
        health: mailboxes.map((m) => ({ address: m.address, reports: 0, spamRate: 0, replyRate: 0, missingRate: 0, slow: false, ...(this.health[m.address] ?? {}) })),
        nextAfterMs: 60_000, pool: { spaces: 2, mailboxes: 4 },
      } });
    }
    return reply(404, { error: { code: "validation.not_found", message: "no" } });
  };
}

let nonceSeq = 0;
const cfgOf = (pool: FakePool, seeds: string[] = []): WarmupConfig => ({
  poolUrl: "https://warmup.test/", signer, http: pool.http, seeds,
  randomBytes: (n) => Uint8Array.from({ length: n }, (_, i) => (i === 0 ? ++nonceSeq : 7)),
});

const SEEDS = ["seed1@gmail.example", "seed2@outlook.example", "seed3@yahoo.example"];

async function warming(w: World, ...ids: string[]): Promise<void> {
  for (const id of ids) await run(w.ctx, "warmup.start", { mailboxId: id });
}
const sentTo = (w: World, mailboxId?: string) => w.mail.filter((m) => mailboxId === undefined || m.input.mailboxId === mailboxId).map((m) => (m.input.to as { address: string }[])[0]!.address);
const status = async (w: World) => (await run<{ mailboxes: { mailboxId: string; stage: string; dailyCap: number; bounceRate: number; replyRate: number }[] }>(w.ctx, "warmup.status", {})).mailboxes;

// ---- the signature ----------------------------------------------------------------------------------------------

test("the signed bytes are the documented ones: tag, method, path, time, nonce and the exact body, one per line", () => {
  assert.equal(new TextDecoder().decode(signedBytes("POST", "/v1/pool/join", "1760000000000", "AAAAAAAAAAAAAAAAAAAAAA", '{"v":1}')), 'vyre-warmup-v1\nPOST\n/v1/pool/join\n1760000000000\nAAAAAAAAAAAAAAAAAAAAAA\n{"v":1}');
});

test("signed headers carry the Space's public key, the time and a nonce, and the signature verifies under that key over exactly those bytes", async () => {
  const h = await signedHeaders(signer, "POST", "/v1/pool/exchange", '{"v":1,"mailboxes":[]}', NOW, Uint8Array.from({ length: 16 }, (_, i) => i));
  assert.deepEqual(Object.keys(h).sort(), ["content-type", "x-vyre-key", "x-vyre-nonce", "x-vyre-sig", "x-vyre-ts"]);
  assert.deepEqual([...unb64(h["x-vyre-key"]!)], [...PUB]);
  assert.equal(h["x-vyre-ts"], String(NOW));
  assert.equal(unb64(h["x-vyre-nonce"]!).length, 16);
  assert.equal(await subtle.verify({ name: "Ed25519" }, pair.publicKey, unb64(h["x-vyre-sig"]!) as BufferSource, signedBytes("POST", "/v1/pool/exchange", String(NOW), h["x-vyre-nonce"]!, '{"v":1,"mailboxes":[]}') as BufferSource), true);
  // a different body, path or method is a different signature
  for (const [method, path, body] of [["POST", "/v1/pool/join", '{"v":1,"mailboxes":[]}'], ["GET", "/v1/pool/exchange", '{"v":1,"mailboxes":[]}'], ["POST", "/v1/pool/exchange", '{"v":1,"mailboxes":[{}]}']] as const) {
    assert.equal(await subtle.verify({ name: "Ed25519" }, pair.publicKey, unb64(h["x-vyre-sig"]!) as BufferSource, signedBytes(method, path, String(NOW), h["x-vyre-nonce"]!, body) as BufferSource), false);
  }
});

test("poolJoin and poolExchange post the contract's bodies to the contract's paths, signed, with a fresh nonce each time, and read the answers", async () => {
  const pool = new FakePool();
  pool.peers["sales@harbor.example"] = ["peer@elsewhere.example"];
  pool.health["sales@harbor.example"] = { reports: 3, spamRate: 0.1, replyRate: 0.5 };
  const cfg = cfgOf(pool);
  assert.deepEqual(await poolJoin(cfg, ["sales@harbor.example"], NOW), { joined: 1, left: false });
  assert.deepEqual(await poolJoin(cfg, [], NOW), { joined: 0, left: true });
  const ex = await poolExchange(cfg, [{ address: "sales@harbor.example", want: 2 }], NOW);
  assert.deepEqual(ex.assignments, [{ address: "sales@harbor.example", peers: ["peer@elsewhere.example"] }]);
  assert.deepEqual(ex.health, [{ address: "sales@harbor.example", reports: 3, spamRate: 0.1, replyRate: 0.5, missingRate: 0, slow: false }]);
  assert.deepEqual(pool.requests.map((r) => [r.method, r.url, r.verified]), [
    ["POST", "https://warmup.test/v1/pool/join", true], ["POST", "https://warmup.test/v1/pool/join", true], ["POST", "https://warmup.test/v1/pool/exchange", true],
  ]);
  assert.deepEqual(pool.requests[0]!.body, { v: 1, mailboxes: [{ address: "sales@harbor.example" }] });
  assert.deepEqual(pool.requests[1]!.body, { v: 1, mailboxes: [] });
  assert.deepEqual(pool.requests[2]!.body, { v: 1, mailboxes: [{ address: "sales@harbor.example", want: 2 }] });
  assert.equal(new Set(pool.requests.map((r) => r.headers["x-vyre-nonce"])).size, 3, "a nonce is never reused");
  assert.ok(pool.requests.every((r) => r.headers["x-vyre-ts"] === String(NOW) && r.headers["x-vyre-key"] === b64(PUB)));
});

test("a pool that refuses, is down or answers without data is an error that names what it said", async () => {
  const pool = new FakePool();
  const cfg = cfgOf(pool);
  pool.fail = { status: 429, code: "rate_limit.exceeded", retryAfterMs: 40_000 };
  await assert.rejects(poolExchange(cfg, [], NOW), (e: Error & { status?: number; code?: string; retryAfterMs?: number }) => e.status === 429 && e.code === "rate_limit.exceeded" && e.retryAfterMs === 40_000);
  pool.fail = null;
  pool.down = true;
  await assert.rejects(poolJoin(cfg, [], NOW), (e: Error & { status?: number; code?: string }) => e.status === 0 && e.code === "provider.network");
  pool.down = false;
  const odd: PoolHttp = async () => ({ status: 200, ok: true, json: async () => ({ hello: "world" }) });
  await assert.rejects(poolJoin({ ...cfg, http: odd }, [], NOW), (e: Error & { code?: string }) => e.code === "provider.bad_response");
});

// ---- opted in ---------------------------------------------------------------------------------------------------

test("opted in: the pass joins with the warming mailboxes, asks for the day's ramp, and sends only to the peers it is given, signed throughout", async () => {
  const w = harness();
  const pool = new FakePool();
  pool.peers["sales@harbor.example"] = ["a@one.example", "b@two.example", "c@three.example"];
  configureWarmup(cfgOf(pool, SEEDS));
  await warming(w, "mbx_sales");
  await run(w.ctx, "warmup.pool_optin_set", { optIn: true });

  const r = await runWarmupPass(w.ctx);
  assert.deepEqual(r, { mode: "pool", mailboxes: 1, sent: 3, refused: 0, slowed: 0, joined: true, left: false, skipped: null });
  assert.deepEqual(pool.requests.map((q) => q.path), ["/v1/pool/join", "/v1/pool/exchange"]);
  assert.ok(pool.requests.every((q) => q.verified), "every request verifies under the Space key");
  assert.deepEqual(pool.requests[0]!.body, { v: 1, mailboxes: [{ address: "sales@harbor.example" }] });
  assert.deepEqual(pool.requests[1]!.body, { v: 1, mailboxes: [{ address: "sales@harbor.example", want: 5 }] }, "day one allows five");
  assert.deepEqual(sentTo(w), ["a@one.example", "b@two.example", "c@three.example"], "only the peers the pool gave, never a seed inbox");
  const m = w.mail[0]!.input;
  assert.equal(m.mailboxId, "mbx_sales");
  assert.ok(typeof m.subject === "string" && m.subject.length > 0 && typeof m.text === "string" && m.text.length > 20);
  assert.match(String(m.idempotencyKey), /^warmup\.mbx_sales\.\d+\.0\.a@one\.example$/);
  assert.equal(new Set(w.mail.map((x) => x.input.idempotencyKey)).size, 3, "each send has its own key");
  assert.equal(w.mail.some((x) => "campaignId" in x.input || "contactId" in x.input), false, "a warmup mail belongs to no campaign and no contact");
});

test("opted in: a second pass the same day does not join again, asks only for what is left of the ramp, and never goes past the cap", async () => {
  const w = harness();
  const pool = new FakePool();
  pool.peers["sales@harbor.example"] = ["a@one.example", "b@two.example", "c@three.example", "d@four.example", "e@five.example", "f@six.example"];
  configureWarmup(cfgOf(pool));
  await warming(w, "mbx_sales");
  await run(w.ctx, "warmup.pool_optin_set", { optIn: true });
  await runWarmupPass(w.ctx);
  pool.requests.length = 0;
  w.advance(60_000);
  const second = await runWarmupPass(w.ctx);
  assert.deepEqual(pool.requests.map((q) => q.path), ["/v1/pool/exchange"], "joined already");
  assert.equal(pool.requests[0]!.body.mailboxes[0].want, 0, "the five are done");
  assert.equal(second.sent, 0);
  assert.equal(w.mail.length, 5, "five, not six");
  assert.equal((await status(w))[0]!.dailyCap, 5);
  w.advance(DAY);
  pool.requests.length = 0;
  const tomorrow = await runWarmupPass(w.ctx);
  assert.equal(pool.requests[0]!.body.mailboxes[0].want, 10, "day two allows ten");
  assert.equal(tomorrow.sent, 6, "the pool gave six peers, all within the ten");
});

test("opted in: a peer that is one of the Space's own mailboxes, on its own domain, not an address, a duplicate, or beyond the quota is not sent to", async () => {
  const w = harness();
  const pool = new FakePool();
  pool.ignoreWant = true;
  pool.peers["sales@harbor.example"] = ["SALES@harbor.example", "someone@harbor.example", "not-an-address", "ok@one.example", "OK@one.example", "b@two.example", "c@three.example", "d@four.example", "e@five.example", "f@six.example"];
  configureWarmup(cfgOf(pool));
  await warming(w, "mbx_sales");
  await run(w.ctx, "warmup.pool_optin_set", { optIn: true });
  const r = await runWarmupPass(w.ctx);
  assert.deepEqual(sentTo(w), ["ok@one.example", "b@two.example", "c@three.example", "d@four.example", "e@five.example"], "five is the day's ramp; f@six.example waits for tomorrow");
  assert.equal(r.sent, 5);
});

test("opted in: several warming mailboxes join together, sorted, and each is sent to its own peers; a mailbox that is already ready is left out", async () => {
  const w = harness();
  const pool = new FakePool();
  pool.peers["sales@harbor.example"] = ["a@one.example"];
  pool.peers["hello@other.example"] = ["b@two.example", "c@three.example"];
  configureWarmup(cfgOf(pool));
  await warming(w, "mbx_sales", "mbx_other");
  await run(w.ctx, "warmup.pool_optin_set", { optIn: true });
  await runWarmupPass(w.ctx);
  assert.deepEqual(pool.requests[0]!.body.mailboxes, [{ address: "hello@other.example" }, { address: "sales@harbor.example" }]);
  assert.deepEqual(sentTo(w, "mbx_sales"), ["a@one.example"]);
  assert.deepEqual(sentTo(w, "mbx_other"), ["b@two.example", "c@three.example"]);
  w.advance(15 * DAY);
  pool.requests.length = 0;
  w.mail.length = 0;
  const later = await runWarmupPass(w.ctx);
  assert.equal(later.mode, "off", "both are ready after fourteen days");
  assert.equal(later.skipped, "no mailbox is warming");
  assert.equal(pool.requests.length, 0);
});

test("opted in: what the peers saw becomes the mailbox's health; spam placement over the limit slows it and announces it once, and the sends stay inside the slowed cap", async () => {
  const w = harness();
  const pool = new FakePool();
  pool.peers["sales@harbor.example"] = ["a@one.example"];
  pool.health["sales@harbor.example"] = { reports: 10, spamRate: 0.2, replyRate: 0.4, missingRate: 0 };
  configureWarmup(cfgOf(pool));
  await warming(w, "mbx_sales");
  await run(w.ctx, "warmup.pool_optin_set", { optIn: true });
  const r = await runWarmupPass(w.ctx);
  assert.equal(r.slowed, 1);
  assert.deepEqual(w.ofName("warmup.slowed").map((e) => [e.subject, e.payload]), [["mailbox/mbx_sales", { mailboxId: "mbx_sales", reason: "spam placement 20.0 percent" }]]);
  const s = (await status(w))[0]!;
  assert.deepEqual([s.stage, s.replyRate], ["slowed", 0.4]);
  w.advance(60_000);
  await runWarmupPass(w.ctx);
  assert.equal(w.ofName("warmup.slowed").length, 1, "announced once");
  // the peers see it clean again: released
  pool.health["sales@harbor.example"] = { reports: 20, spamRate: 0, replyRate: 0.5, missingRate: 0 };
  w.advance(60_000);
  await runWarmupPass(w.ctx);
  assert.notEqual((await status(w))[0]!.stage, "slowed", "released");
});

test("opted in: the peers' missing mail counts toward the bounce rate along with the provider's own refusals, whichever is higher", async () => {
  const w = harness();
  const pool = new FakePool();
  pool.peers["sales@harbor.example"] = ["a@one.example", "b@two.example"];
  pool.health["sales@harbor.example"] = { reports: 10, missingRate: 0.2 };
  configureWarmup(cfgOf(pool));
  await warming(w, "mbx_sales");
  await run(w.ctx, "warmup.pool_optin_set", { optIn: true });
  await runWarmupPass(w.ctx);
  assert.equal((await status(w))[0]!.bounceRate, 0.2);
  assert.equal(w.ofName("warmup.slowed").length, 1);
});

test("opted in: a pool that is down, asks to wait, or says the Space is not joined sends nothing, keeps the health, and recovers on a later pass", async () => {
  const w = harness();
  const pool = new FakePool();
  pool.peers["sales@harbor.example"] = ["a@one.example"];
  configureWarmup(cfgOf(pool));
  await warming(w, "mbx_sales");
  await run(w.ctx, "warmup.pool_optin_set", { optIn: true });

  pool.down = true;
  assert.deepEqual(await runWarmupPass(w.ctx), { mode: "pool", mailboxes: 1, sent: 0, refused: 0, slowed: 0, joined: false, left: false, skipped: "the pool said no: provider.network" });
  pool.down = false;
  pool.fail = { status: 429, code: "rate_limit.exceeded", retryAfterMs: 1000 };
  assert.equal((await runWarmupPass(w.ctx)).skipped, "the pool asked to wait");
  pool.fail = null;
  assert.equal(w.mail.length, 0);
  assert.ok(w.warnings.some((m) => m.includes("could not use the pool")));

  // joined, then the pool forgets the Space (it was away longer than the time to live): the next pass joins again
  const ok = await runWarmupPass(w.ctx);
  assert.equal(ok.sent, 1);
  pool.requests.length = 0;
  pool.fail = { status: 401, code: "auth.not_joined" };
  w.advance(60_000);
  assert.equal((await runWarmupPass(w.ctx)).skipped, "the pool said no: auth.not_joined");
  pool.fail = null;
  pool.requests.length = 0;
  w.advance(60_000);
  const back = await runWarmupPass(w.ctx);
  assert.equal(back.joined, true);
  assert.deepEqual(pool.requests.map((q) => q.path), ["/v1/pool/join", "/v1/pool/exchange"]);
});

// ---- opted out --------------------------------------------------------------------------------------------------

test("opted out: the pool is never contacted; the day's ramp goes to the Space's own seed inboxes in turn, and a seed that is the mailbox itself is skipped", async () => {
  const w = harness();
  const pool = new FakePool();
  configureWarmup(cfgOf(pool, [...SEEDS, "SALES@harbor.example"]));
  await warming(w, "mbx_sales");
  assert.equal((await run<{ optIn: boolean }>(w.ctx, "warmup.pool_optin_set", { optIn: false })).optIn, false);

  const r = await runWarmupPass(w.ctx);
  assert.deepEqual(r, { mode: "seeds", mailboxes: 1, sent: 5, refused: 0, slowed: 0, joined: false, left: false, skipped: null });
  assert.equal(pool.requests.length, 0, "no call to the pool at all");
  assert.deepEqual(sentTo(w), ["seed1@gmail.example", "seed2@outlook.example", "seed3@yahoo.example", "seed1@gmail.example", "seed2@outlook.example"]);
  assert.ok(sentTo(w).every((a) => SEEDS.includes(a)), "own seeds only");

  // the next day the rotation carries on where it stopped
  w.advance(DAY);
  w.mail.length = 0;
  const next = await runWarmupPass(w.ctx);
  assert.equal(next.sent, 10);
  assert.deepEqual(sentTo(w).slice(0, 3), ["seed3@yahoo.example", "seed1@gmail.example", "seed2@outlook.example"]);
  assert.equal(pool.requests.length, 0);
});

test("opted out is also what a Space is before anyone opts in: the pool is off by default", async () => {
  const w = harness();
  const pool = new FakePool();
  configureWarmup(cfgOf(pool, SEEDS));
  await warming(w, "mbx_sales");
  const r = await runWarmupPass(w.ctx);
  assert.equal(r.mode, "seeds");
  assert.equal(pool.requests.length, 0);
});

test("opted out with no seed inbox: nothing is sent, and the pass says why", async () => {
  const w = harness();
  const pool = new FakePool();
  configureWarmup(cfgOf(pool, ["sales@harbor.example", "not-an-address"]));
  await warming(w, "mbx_sales");
  const r = await runWarmupPass(w.ctx);
  assert.deepEqual([r.sent, r.skipped], [0, "this Space has no seed inbox to warm up with"]);
  assert.equal(w.mail.length, 0);
  assert.equal(pool.requests.length, 0);
});

test("opting out of a pool the Space joined: one signed leave (an empty list), then the pool is never contacted again; a failed leave is tried again and the Space warms up on its seeds meanwhile", async () => {
  const w = harness();
  const pool = new FakePool();
  pool.peers["sales@harbor.example"] = ["a@one.example"];
  configureWarmup(cfgOf(pool, SEEDS));
  await warming(w, "mbx_sales");
  await run(w.ctx, "warmup.pool_optin_set", { optIn: true });
  await runWarmupPass(w.ctx);
  pool.requests.length = 0;
  w.mail.length = 0;

  await run(w.ctx, "warmup.pool_optin_set", { optIn: false });
  pool.joinFail = 503;
  w.advance(60_000);
  const failed = await runWarmupPass(w.ctx);
  assert.deepEqual(pool.requests.map((q) => [q.path, q.body]), [["/v1/pool/join", { v: 1, mailboxes: [] }]]);
  assert.equal(failed.left, false);
  assert.equal(failed.mode, "seeds");
  assert.ok(sentTo(w).every((a) => SEEDS.includes(a)), "seeds only while the leave is pending");
  assert.ok(w.warnings.some((m) => m.includes("could not leave the warmup pool")));

  pool.joinFail = null;
  pool.requests.length = 0;
  w.advance(60_000);
  const left = await runWarmupPass(w.ctx);
  assert.equal(left.left, true);
  assert.deepEqual(pool.requests.map((q) => [q.path, q.body, q.verified]), [["/v1/pool/join", { v: 1, mailboxes: [] }, true]]);

  pool.requests.length = 0;
  w.advance(60_000);
  await runWarmupPass(w.ctx);
  assert.equal(pool.requests.length, 0, "never again");
});

// ---- counting and health ---------------------------------------------------------------------------------------

test("refusals by the provider count toward the bounce rate and slow the mailbox; a send held for approval or suppressed counts as neither", async () => {
  const w = harness();
  const pool = new FakePool();
  configureWarmup(cfgOf(pool, SEEDS));
  await warming(w, "mbx_sales");
  let n = 0;
  w.state.mailFail = () => (++n <= 4 ? new VyreErr({ code: "provider.auth_failed", message: "no", retryable: false, traceId: "0123456789abcdef0123456789abcdef", next: [{ kind: "report", label: "Report a problem" }] }) : null);
  const r = await runWarmupPass(w.ctx);
  assert.deepEqual([r.sent, r.refused, r.slowed], [1, 4, 1]);
  const s = (await status(w))[0]!;
  assert.deepEqual([s.stage, s.bounceRate], ["slowed", 0.8]);
  assert.equal(w.ofName("warmup.slowed").length, 1);

  const h = harness();
  configureWarmup(cfgOf(new FakePool(), SEEDS));
  await warming(h, "mbx_sales");
  h.state.mailStatus = () => "held";
  const held = await runWarmupPass(h.ctx);
  assert.deepEqual([held.sent, held.refused], [0, 0]);
  assert.equal(h.mail.length, 5, "the sends were attempted and held");
  assert.equal((await status(h))[0]!.stage, "new");
});

test("the counters are per mailbox and per day; old days are dropped; a mailbox that cannot be read is skipped with a warning", async () => {
  const w = harness();
  configureWarmup(cfgOf(new FakePool(), SEEDS));
  await warming(w, "mbx_sales");
  await runWarmupPass(w.ctx);
  const keys = () => w.db.all("SELECT * FROM campaigns_setting").map((r) => String((r as { key: string }).key)).filter((k) => k.startsWith("warmup_day:"));
  assert.equal(keys().length, 1);
  w.advance(10 * DAY);
  w.mail.length = 0;
  await runWarmupPass(w.ctx);
  assert.deepEqual(keys().map((k) => k.split(":")[2]).length, 1, "the old day was pruned");
  // a mailbox that vanished from the mail module
  w.state.mailboxes = {};
  const r = await runWarmupPass(w.ctx);
  assert.equal(r.mailboxes, 0);
  assert.ok(w.warnings.some((m) => m.includes("could not be read")));
});

test("not configured: a pass does nothing and says so; a configured Space with no warming mailbox does nothing", async () => {
  const w = harness();
  configureWarmup(null);
  assert.deepEqual(await runWarmupPass(w.ctx), { mode: "off", mailboxes: 0, sent: 0, refused: 0, slowed: 0, joined: false, left: false, skipped: "warmup is not set up on this server" });
  configureWarmup(cfgOf(new FakePool(), SEEDS));
  assert.equal((await runWarmupPass(w.ctx)).skipped, "no mailbox is warming");
  assert.equal(w.mail.length, 0);
});

test("cleanup", () => {
  configureWarmup(null);
});
