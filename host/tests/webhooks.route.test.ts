// P-L5_17: the webhook route's own rules, on a plain http server with a stand-in connector: only POST, a body cap, one answer for every refusal, and a budget per source so the route cannot be
// used to flood the verifier (all requests, and the ones that fail verification).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { AUTOMATION_HOOKS_PER_MINUTE, createWebhookRoute, DEFAULT_WEBHOOK_BUDGET, MAX_WEBHOOK_BYTES } from "../src/routes/webhooks.ts";

type Accept = (connector: string, a: { headers: Readonly<Record<string, string | undefined>>; body: string; url: string; kind?: string }) => Promise<unknown>;

async function serve(accept: Accept, opts: { budget?: { perMinute: number; failuresPerMinute: number }; now?: () => number } = {}) {
  const route = createWebhookRoute({ has: (c) => c === "demo" || c === "dropbox", accept, publicBase: () => "https://space.example/", ...opts });
  const server = http.createServer((req, res) => { if (!route.handle(req, res)) { res.writeHead(404); res.end("{}"); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { url, close: () => new Promise<void>((r) => server.close(() => r())) };
}
const bad = () => Promise.reject({ error: { code: "auth.bad_credentials" } });

test("a good event is answered, the address handed on is the Space's own, and every refusal reads the same", async () => {
  const seen: string[] = [];
  const s = await serve(async (_c, a) => { seen.push(a.url); if (a.body === "bad") return bad(); if (a.body === "odd") return Promise.reject({ error: { code: "validation.bad_input" } }); return { accepted: true }; });
  try {
    const ok = await fetch(`${s.url}/hooks/demo/sms?x=1`, { method: "POST", body: "fine" });
    assert.equal(ok.status, 200);
    assert.deepEqual(seen, ["https://space.example/hooks/demo/sms?x=1"], "the provider signed the Space's address, not the local one");
    const refused = await fetch(`${s.url}/hooks/demo`, { method: "POST", body: "bad" });
    assert.equal(refused.status, 401);
    assert.equal((await refused.json() as { error: { code: string } }).error.code, "auth.bad_credentials");
    assert.equal((await fetch(`${s.url}/hooks/demo`, { method: "POST", body: "odd" })).status, 400);
    assert.equal((await fetch(`${s.url}/hooks/demo`)).status, 405, "only POST");
    assert.equal((await fetch(`${s.url}/hooks/nothing`, { method: "POST", body: "x" })).status, 404, "no such connector");
    assert.equal((await fetch(`${s.url}/hooks/demo`, { method: "POST", body: "x".repeat(MAX_WEBHOOK_BYTES + 1) })).status, 413);
  } finally { await s.close(); }
});

test("Dropbox's address check: a GET with a challenge is answered with the text, nothing else is a GET", async () => {
  let asked = 0;
  const s = await serve(async () => { asked += 1; return { accepted: true }; });
  try {
    const ok = await fetch(`${s.url}/hooks/dropbox?challenge=abc_DEF-123.x`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), "abc_DEF-123.x");
    assert.equal(ok.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
    assert.equal((await fetch(`${s.url}/hooks/dropbox?challenge=${encodeURIComponent("<script>alert(1)</script>")}`)).status, 400, "only plain tokens are echoed");
    assert.equal((await fetch(`${s.url}/hooks/dropbox`)).status, 405, "no challenge, no GET");
    assert.equal((await fetch(`${s.url}/hooks/demo?challenge=abc`)).status, 405, "another connector does not echo");
    assert.equal(asked, 0, "the check records nothing and asks nobody");
  } finally { await s.close(); }
});

test("a source that fails verification too often is stopped before the verifier is asked again", async () => {
  let asked = 0;
  const s = await serve(async () => { asked += 1; return bad(); }, { budget: { perMinute: 1000, failuresPerMinute: 3 } });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await fetch(`${s.url}/hooks/demo`, { method: "POST", body: "guess" })).status, 401);
    const stopped = await fetch(`${s.url}/hooks/demo`, { method: "POST", body: "guess" });
    assert.equal(stopped.status, 429);
    assert.equal(stopped.headers.get("retry-after"), "60");
    assert.equal(asked, 3, "the verifier was not asked a fourth time");
  } finally { await s.close(); }
});

test("the request budget counts every request, and a minute later the source is let in again", async () => {
  let clock = 1_000_000;
  let asked = 0;
  const s = await serve(async () => { asked += 1; return { accepted: true }; }, { budget: { perMinute: 5, failuresPerMinute: 5 }, now: () => clock });
  try {
    for (let i = 0; i < 5; i++) assert.equal((await fetch(`${s.url}/hooks/demo`, { method: "POST", body: "e" })).status, 200);
    assert.equal((await fetch(`${s.url}/hooks/demo`, { method: "POST", body: "e" })).status, 429);
    assert.equal(asked, 5);
    clock += 61_000;
    assert.equal((await fetch(`${s.url}/hooks/demo`, { method: "POST", body: "e" })).status, 200, "the window has passed");
  } finally { await s.close(); }
  assert.ok(DEFAULT_WEBHOOK_BUDGET.perMinute > DEFAULT_WEBHOOK_BUDGET.failuresPerMinute);
});

test("Microsoft's subscription handshake is answered with its token as plain text", async () => {
  const s = await serve(async (_c, a) => ({ accepted: true, validationToken: new URL(a.url).searchParams.get("validationToken") }));
  try {
    const r = await fetch(`${s.url}/hooks/demo?validationToken=Validation%3A+abc`, { method: "POST" });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(await r.text(), "Validation: abc");
  } finally { await s.close(); }
});

test("an automation's webhook: a bare 404 for a refusal, a cap per automation that other automations do not share, and the key and payload reach the module", async () => {
  const seen: { automationId: string; secret: string; payload: unknown; idempotencyKey?: string }[] = [];
  const route = createWebhookRoute({
    has: () => false, accept: async () => ({}), publicBase: () => "https://space.example/",
    automation: async (a) => { seen.push(a); return a.secret === "goodsecret1" ? { accepted: true } : null; },
  });
  const server = http.createServer((req, res) => { if (!route.handle(req, res)) { res.writeHead(404); res.end("{}"); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const ok = await fetch(`${url}/hooks/automation/aut_one/goodsecret1`, { method: "POST", body: '{"a":1}', headers: { "idempotency-key": "k-1" } });
    assert.equal(ok.status, 200);
    assert.deepEqual(seen[0], { automationId: "aut_one", secret: "goodsecret1", payload: { a: 1 }, idempotencyKey: "k-1" });
    const text = await fetch(`${url}/hooks/automation/aut_one/goodsecret1`, { method: "POST", body: "plain words" });
    assert.equal(text.status, 200);
    assert.deepEqual(seen[1]!.payload, { text: "plain words" });
    const no = await fetch(`${url}/hooks/automation/aut_one/wrongsecret`, { method: "POST", body: "{}" });
    assert.equal(no.status, 404);
    assert.equal(await no.text(), "");
    assert.equal((await fetch(`${url}/hooks/automation/aut_one/goodsecret1`)).status, 405);
    assert.equal((await fetch(`${url}/hooks/automation/aut_one/goodsecret1`, { method: "POST", body: "x".repeat(MAX_WEBHOOK_BYTES + 1) })).status, 413);
  } finally { await new Promise<void>((r) => server.close(() => r())); }

  let clock = 5_000_000;
  const quiet = createWebhookRoute({ has: () => false, accept: async () => ({}), publicBase: () => "https://space.example/", now: () => clock, budget: { perMinute: 100_000, failuresPerMinute: 100_000 }, automation: async () => ({ accepted: true }) });
  const s2 = http.createServer((req, res) => { if (!quiet.handle(req, res)) { res.writeHead(404); res.end("{}"); } });
  await new Promise<void>((r) => s2.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(s2.address() as { port: number }).port}`;
  try {
    for (let i = 0; i < AUTOMATION_HOOKS_PER_MINUTE; i++) assert.equal((await fetch(`${base}/hooks/automation/aut_busy/goodsecret1`, { method: "POST", body: "{}" })).status, 200);
    assert.equal((await fetch(`${base}/hooks/automation/aut_busy/goodsecret1`, { method: "POST", body: "{}" })).status, 429);
    assert.equal((await fetch(`${base}/hooks/automation/aut_calm/goodsecret1`, { method: "POST", body: "{}" })).status, 200, "another automation is not held back");
    clock += 61_000;
    assert.equal((await fetch(`${base}/hooks/automation/aut_busy/goodsecret1`, { method: "POST", body: "{}" })).status, 200, "a minute later it is let in again");
  } finally { await new Promise<void>((r) => s2.close(() => r())); }
});
