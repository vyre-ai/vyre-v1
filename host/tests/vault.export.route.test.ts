// The vault .env pull route over a real node:http server, with a pull that behaves like vault.exportPull (token hash, expiry, revocation): a link is used once, a second use is refused,
// an expired and a revoked link are refused, every refusal looks the same, and nothing but the export id is logged.
// @reads /host/src/routes/vault-export.ts
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createVaultExportRoute } from "../src/routes/vault-export.ts";

const ENV = "STRIPE_KEY=\"sk_live_abc\"\nRESEND_KEY=\"re_123\"\n";
const NOW = 1_760_000_000_000;

interface Row { token: string; expiresAt: number; revoked: boolean }

async function boot() {
  const rows = new Map<string, Row>([
    ["vex_good", { token: "tok_good", expiresAt: NOW + 3_600_000, revoked: false }],
    ["vex_old", { token: "tok_old", expiresAt: NOW - 1, revoked: false }],
    ["vex_revoked", { token: "tok_rev", expiresAt: NOW + 3_600_000, revoked: true }],
  ]);
  const logged: Array<Record<string, unknown>> = [];
  let pulls = 0;
  const route = createVaultExportRoute({
    pull(id, token) {
      pulls++;
      const r = rows.get(id);
      if (!r || r.revoked || r.expiresAt <= NOW || r.token !== token) throw new Error("closed");
      return ENV;
    },
    log: (e) => logged.push(e),
  });
  const server = http.createServer((req, res) => { if (!route.handle(req, res)) { res.writeHead(404); res.end("other"); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { rows, logged, pulls: () => pulls, get: (p: string, init?: RequestInit) => fetch(`${base}${p}`, init), close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

test("a link is used once: the first pull gets the .env with no-store headers, the second is refused", async (t) => {
  const w = await boot();
  t.after(w.close);
  const first = await w.get("/exports/vex_good?token=tok_good");
  assert.equal(first.status, 200);
  assert.equal(await first.text(), ENV);
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.match(String(first.headers.get("content-type")), /^text\/plain/);
  assert.match(String(first.headers.get("content-disposition")), /attachment; filename="\.env"/);
  assert.equal(first.headers.get("x-content-type-options"), "nosniff");
  const second = await w.get("/exports/vex_good?token=tok_good");
  assert.equal(second.status, 404);
  assert.equal(w.pulls(), 1, "the second use never reached the vault");
});

test("an expired link and a revoked link are refused", async (t) => {
  const w = await boot();
  t.after(w.close);
  assert.equal((await w.get("/exports/vex_old?token=tok_old")).status, 404);
  assert.equal((await w.get("/exports/vex_revoked?token=tok_rev")).status, 404);
  w.rows.get("vex_good")!.revoked = true;
  assert.equal((await w.get("/exports/vex_good?token=tok_good")).status, 404, "revoked before the first pull");
});

test("every refusal looks the same, and a wrong token does not use the link up", async (t) => {
  const w = await boot();
  t.after(w.close);
  const bodies = await Promise.all([
    w.get("/exports/vex_good?token=wrong"), w.get("/exports/vex_nobody?token=x"), w.get("/exports/vex_old?token=tok_old"), w.get("/exports/vex_good"),
  ].map(async (p) => { const r = await p; return `${r.status} ${r.headers.get("cache-control")} ${await r.text()}`; }));
  assert.equal(new Set(bodies).size, 1);
  assert.match(bodies[0] as string, /^404 no-store /);
  assert.equal((await w.get("/exports/vex_good?token=tok_good")).status, 200, "the real holder still gets it");
});

test("two pulls at once get one answer", async (t) => {
  const w = await boot();
  t.after(w.close);
  const codes = (await Promise.all([w.get("/exports/vex_good?token=tok_good"), w.get("/exports/vex_good?token=tok_good")])).map((r) => r.status).sort();
  assert.deepEqual(codes, [200, 404]);
});

test("HEAD and POST cannot use a link up, and other paths are not this route's", async (t) => {
  const w = await boot();
  t.after(w.close);
  assert.equal((await w.get("/exports/vex_good?token=tok_good", { method: "HEAD" })).status, 405);
  assert.equal((await w.get("/exports/vex_good?token=tok_good", { method: "POST" })).status, 405);
  assert.equal(w.pulls(), 0);
  assert.equal(await (await w.get("/spaces/spc_core/blobs/blb_x")).text(), "other");
  assert.equal((await w.get("/exports/vex_good?token=tok_good")).status, 200);
});

test("nothing is logged but the export id and the outcome", async (t) => {
  const w = await boot();
  t.after(w.close);
  await w.get("/exports/vex_good?token=tok_good");
  await w.get("/exports/vex_good?token=tok_good");
  assert.deepEqual(w.logged, [{ exportId: "vex_good", outcome: "pulled" }, { exportId: "vex_good", outcome: "refused" }]);
  assert.ok(!JSON.stringify(w.logged).includes("tok_good") && !JSON.stringify(w.logged).includes("sk_live"));
});
