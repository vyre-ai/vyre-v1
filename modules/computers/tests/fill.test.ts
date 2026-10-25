// The host side of Vault fill for an agent computer (P-L2_21), over a real HTTP server: the token is checked (401), it is for one computer (403), the Vault source decides whether the agent acting for
// the person may use the item (allowed 200 with value and item id, refused 403, missing 404), every use is logged without its value, a fill whose log cannot be written is not handed out, and a
// computer's token ends with revoke. The wire shape is what images/agent-computer/agentd/vault.ts sends and reads.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createFillService, fillHttp } from "../handlers/fill.ts";
import type { FillLookup, FillUse } from "../handlers/fill.ts";

const SECRET = "sk-test-VALUE-0123456789abcdef";

function world(over: { logFails?: boolean; lookupThrows?: boolean } = {}) {
  const uses: FillUse[] = [];
  const asked: Array<{ handle: string; who: unknown }> = [];
  const items: Record<string, FillLookup> = {
    "#Stripe.api_key": { kind: "value", itemId: "vit_stripe", value: SECRET },
    "#Payroll.password": { kind: "denied", reason: "no_access" },
  };
  const svc = createFillService({
    source: { lookup: async (handle, who) => { asked.push({ handle, who }); if (over.lookupThrows) throw new Error(`boom with ${SECRET}`); return items[handle] ?? { kind: "unknown" }; } },
    log: (u) => { if (over.logFails) throw new Error("disk full"); uses.push(u); },
    now: () => 1_760_000_000_000,
  });
  return { svc, uses, asked };
}

async function serve(svc: ReturnType<typeof createFillService>): Promise<{ url: string; close(): Promise<void> }> {
  const server = http.createServer(fillHttp(svc));
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/fill`, close: () => new Promise<void>((ok) => server.close(() => ok())) };
}

const post = async (url: string, token: string | null, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> => {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as Record<string, unknown> };
};

test("an allowed fill answers 200 with the value and the item id, asks as the agent acting for the person, and logs the use without the value", async () => {
  const w = world();
  const g = await w.svc.issue({ computerId: "cmp_1", agentId: "agt_1", asker: "usr_dana" });
  assert.match(g.fillToken, /^[0-9a-f]{48}$/);
  assert.ok(g.fillToken.length >= 16, "agentd needs at least 16 characters");
  const s = await serve(w.svc);
  try {
    const r = await post(s.url, g.fillToken, { handle: "Stripe", field: "api_key", computerId: "cmp_1" });
    assert.deepEqual([r.status, r.json], [200, { value: SECRET, itemId: "vit_stripe" }]);
    assert.deepEqual(w.asked, [{ handle: "#Stripe.api_key", who: { agentId: "agt_1", asker: "usr_dana", where: "computer" } }]);
    assert.deepEqual(w.uses, [{ computerId: "cmp_1", agentId: "agt_1", asker: "usr_dana", handle: "#Stripe.api_key", itemId: "vit_stripe", outcome: "filled", at: 1_760_000_000_000 }]);
    assert.equal(JSON.stringify(w.uses).includes(SECRET), false, "the log never holds the value");
  } finally { await s.close(); }
});

test("an item the agent may not use is 403, a handle with no value is 404, and both are logged as refused or missing", async () => {
  const w = world();
  const g = await w.svc.issue({ computerId: "cmp_1", agentId: "agt_1", asker: "usr_dana" });
  const s = await serve(w.svc);
  try {
    const no = await post(s.url, g.fillToken, { handle: "Payroll", field: "password", computerId: "cmp_1" });
    assert.deepEqual([no.status, no.json], [403, { code: "forbidden" }]);
    const gone = await post(s.url, g.fillToken, { handle: "Nothing", field: "here", computerId: "cmp_1" });
    assert.deepEqual([gone.status, gone.json], [404, { code: "not_found" }]);
    assert.deepEqual(w.uses.map((u) => [u.handle, u.outcome]), [["#Payroll.password", "refused"], ["#Nothing.here", "missing"]]);
  } finally { await s.close(); }
});

test("a missing, wrong or another computer's token is 401, and nothing is asked of the Vault", async () => {
  const w = world();
  const a = await w.svc.issue({ computerId: "cmp_1", agentId: "agt_1", asker: "usr_dana" });
  const s = await serve(w.svc);
  try {
    const body = { handle: "Stripe", field: "api_key", computerId: "cmp_1" };
    assert.equal((await post(s.url, null, body)).status, 401);
    assert.equal((await post(s.url, "x".repeat(48), body)).status, 401);
    assert.equal((await post(s.url, `${a.fillToken}0`, body)).status, 401);
    assert.equal(w.asked.length, 0);
    assert.equal(w.uses.length, 0);
  } finally { await s.close(); }
});

test("a token is for one computer: a body that names another computer is 403 and asks nothing", async () => {
  const w = world();
  const a = await w.svc.issue({ computerId: "cmp_1", agentId: "agt_1", asker: "usr_dana" });
  await w.svc.issue({ computerId: "cmp_2", agentId: "agt_2", asker: "usr_ravi" });
  const s = await serve(w.svc);
  try {
    const r = await post(s.url, a.fillToken, { handle: "Stripe", field: "api_key", computerId: "cmp_2" });
    assert.deepEqual([r.status, r.json], [403, { code: "forbidden" }]);
    assert.equal(w.asked.length, 0);
  } finally { await s.close(); }
});

test("a body that is not a handle and field is 400, and a GET is 404", async () => {
  const w = world();
  const g = await w.svc.issue({ computerId: "cmp_1", agentId: "agt_1", asker: "usr_dana" });
  const s = await serve(w.svc);
  try {
    for (const bad of [{}, { handle: "Stripe" }, { handle: "../x", field: "y", computerId: "cmp_1" }, { handle: "Stripe", field: "a b", computerId: "cmp_1" }, { handle: 1, field: 2 }]) {
      assert.equal((await post(s.url, g.fillToken, bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await fetch(s.url)).status, 404);
    assert.equal(w.asked.length, 0);
  } finally { await s.close(); }
});

test("a Vault that fails is 503 without its error text, and a fill whose log cannot be written is not handed out", async () => {
  const down = world({ lookupThrows: true });
  const g1 = await down.svc.issue({ computerId: "cmp_1", agentId: "agt_1", asker: "usr_dana" });
  const s1 = await serve(down.svc);
  try {
    const r = await post(s1.url, g1.fillToken, { handle: "Stripe", field: "api_key", computerId: "cmp_1" });
    assert.deepEqual([r.status, r.json], [503, { code: "unavailable" }]);
    assert.equal(JSON.stringify(r).includes(SECRET), false);
  } finally { await s1.close(); }
  const noLog = world({ logFails: true });
  const g2 = await noLog.svc.issue({ computerId: "cmp_1", agentId: "agt_1", asker: "usr_dana" });
  const s2 = await serve(noLog.svc);
  try {
    const r = await post(s2.url, g2.fillToken, { handle: "Stripe", field: "api_key", computerId: "cmp_1" });
    assert.equal(r.status, 503);
    assert.equal(JSON.stringify(r).includes(SECRET), false, "the value is not delivered when the use cannot be recorded");
    const refused = await post(s2.url, g2.fillToken, { handle: "Payroll", field: "password", computerId: "cmp_1" });
    assert.equal(refused.status, 403, "a refusal stays a refusal when its log fails");
  } finally { await s2.close(); }
});

test("issuing again for a computer ends its earlier token, and revoke ends the current one", async () => {
  const w = world();
  const first = await w.svc.issue({ computerId: "cmp_1", agentId: "agt_1", asker: "usr_dana" });
  const second = await w.svc.issue({ computerId: "cmp_1", agentId: "agt_1", asker: "usr_dana" });
  assert.notEqual(first.fillToken, second.fillToken);
  assert.equal(w.svc.live(), 1);
  const s = await serve(w.svc);
  try {
    const body = { handle: "Stripe", field: "api_key", computerId: "cmp_1" };
    assert.equal((await post(s.url, first.fillToken, body)).status, 401);
    assert.equal((await post(s.url, second.fillToken, body)).status, 200);
    first.revoke();
    assert.equal((await post(s.url, second.fillToken, body)).status, 200, "an old grant cannot revoke the new token");
    second.revoke();
    assert.equal((await post(s.url, second.fillToken, body)).status, 401);
    assert.equal(w.svc.live(), 0);
  } finally { await s.close(); }
});
