import test from "node:test";
import assert from "node:assert/strict";
import { dropKeyOnOwnNode, holdKeyOnOwnNode, isLoopbackUrl } from "./local-key.ts";

const key = new Uint8Array(32).fill(7);

test("local key: only a loopback address counts as this computer", () => {
  for (const u of ["http://127.0.0.1:7777", "http://localhost:3000", "http://[::1]:8420"]) assert.equal(isLoopbackUrl(u), true, u);
  for (const u of ["https://northwind.vyre.run", "http://10.0.0.2:7777", "http://127.0.0.1.evil.test", "not a url", "ftp://127.0.0.1"]) assert.equal(isLoopbackUrl(u), false, u);
});

test("local key: the key is sent to a loopback daemon as base64 with the bearer token", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response(null, { status: 204 }); }) as unknown as typeof fetch;
  assert.equal(await holdKeyOnOwnNode("http://127.0.0.1:7777/", "vst_1", key, f), true);
  assert.equal(seen[0]!.url, "http://127.0.0.1:7777/local/vault/key/unlock");
  assert.deepEqual(JSON.parse(String(seen[0]!.init.body)), { key: btoa(String.fromCharCode(...key)) });
  assert.equal((seen[0]!.init.headers as Record<string, string>)["authorization"], "Bearer vst_1");
});

test("local key: a Space on another machine never receives the key, and sign-out only locks a local node", async () => {
  let calls = 0;
  const f = (async () => { calls++; return new Response(null, { status: 204 }); }) as unknown as typeof fetch;
  assert.equal(await holdKeyOnOwnNode("https://northwind.vyre.run", "t", key, f), false);
  await dropKeyOnOwnNode("https://northwind.vyre.run", "t", f);
  assert.equal(calls, 0);
  await dropKeyOnOwnNode("http://localhost:3000", "t", f);
  assert.equal(calls, 1);
  const refused = (async () => new Response("{}", { status: 403 })) as unknown as typeof fetch;
  assert.equal(await holdKeyOnOwnNode("http://127.0.0.1:1", "t", key, refused), false, "a refusal is not an unlock");
});
