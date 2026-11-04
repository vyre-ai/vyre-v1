// The CI seam: the cloud key goes only to the provider's API host, is read for one call, and a bad handle or path never reaches the Vault.
import test from "node:test";
import assert from "node:assert/strict";
import { createCiHost } from "./ci.ts";

const ctx = { space: "spc_test", trace: { traceId: "0123456789abcdef0123456789abcdef" }, now: () => 0, db: { all: () => [] } };

function rig(value = "do_key_value") {
  const seen: Array<{ url: string; headers: Record<string, string>; method?: string }> = [];
  const asked: string[] = [];
  const host = createCiHost({
    vault: { secret: async (h: string) => { asked.push(h); return value; } } as never,
    fetch: async (url, init) => { seen.push({ url, headers: (init?.headers ?? {}) as Record<string, string>, ...(init?.method ? { method: init.method } : {}) }); return { status: 202, text: async () => "{}", arrayBuffer: async () => new ArrayBuffer(0) }; },
  });
  return { host, seen, asked };
}

test("the key goes in the header to api.digitalocean.com only", async () => {
  const r = rig();
  const out = await r.host.cloud(ctx, "#Northwind_DO", { method: "GET", path: "/v2/droplets", query: { tag_name: "vyre-ci", per_page: 200 } });
  assert.equal(out.status, 202);
  assert.equal(r.seen[0]!.url, "https://api.digitalocean.com/v2/droplets?tag_name=vyre-ci&per_page=200");
  assert.equal(r.seen[0]!.headers["authorization"], "Bearer do_key_value");
  assert.deepEqual(r.asked, ["#Northwind_DO"]);
  await r.host.cloud(ctx, "#Northwind_DO.token", { method: "POST", path: "/v2/droplets", body: { name: "x" } });
  assert.equal(r.asked[1], "#Northwind_DO.token");
});

test("a handle that is not a Vault handle, or a path outside /v2/, never reaches the Vault or the network", async () => {
  const r = rig();
  for (const h of ["Northwind_DO", "#a b", "#../x", ""]) await assert.rejects(r.host.cloud(ctx, h, { method: "GET", path: "/v2/droplets" }));
  for (const p of ["/droplets", "/v2/../x", "https://evil.example/v2/x", "//evil.example/v2/x"]) await assert.rejects(r.host.cloud(ctx, "#K", { method: "GET", path: p }));
  assert.equal(r.asked.length, 0);
  assert.equal(r.seen.length, 0);
});

test("an empty or missing key answers a plain auth failure and calls nothing", async () => {
  const r = rig("");
  await assert.rejects(r.host.cloud(ctx, "#K", { method: "GET", path: "/v2/droplets" }), (e: any) => e.error.code === "provider.auth_failed");   // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(r.seen.length, 0);
});
