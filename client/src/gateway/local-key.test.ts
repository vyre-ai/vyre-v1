import test from "node:test";
import assert from "node:assert/strict";
import { dropKeyOnOwnNode, holdKeyOnOwnNode, isLoopbackUrl, keyDoor } from "./local-key.ts";

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

test("local key: a Space server takes the key over https only (owner ruling 3 Nov), plain http to another machine never; sign-out locks wherever it was held", async () => {
  const urls: string[] = [];
  const f = (async (url: string) => { urls.push(url); return new Response(null, { status: 204 }); }) as unknown as typeof fetch;
  assert.equal(keyDoor("https://northwind.vyre.run/"), "https://northwind.vyre.run/vault/key");
  assert.equal(keyDoor("http://127.0.0.1:7777"), "http://127.0.0.1:7777/local/vault/key");
  assert.equal(keyDoor("http://10.0.0.2:7777"), null);
  assert.equal(await holdKeyOnOwnNode("http://10.0.0.2:7777", "t", key, f), false);
  await dropKeyOnOwnNode("http://10.0.0.2:7777", "t", f);
  assert.equal(urls.length, 0, "nothing goes over plain http to another machine");
  assert.equal(await holdKeyOnOwnNode("https://northwind.vyre.run", "t", key, f), true);
  assert.equal(urls[0], "https://northwind.vyre.run/vault/key/unlock");
  await dropKeyOnOwnNode("https://northwind.vyre.run", "t", f);
  assert.equal(urls[1], "https://northwind.vyre.run/vault/key/lock");
  await dropKeyOnOwnNode("http://localhost:3000", "t", f);
  assert.equal(urls[2], "http://localhost:3000/local/vault/key/lock");
  const refused = (async () => new Response("{}", { status: 403 })) as unknown as typeof fetch;
  assert.equal(await holdKeyOnOwnNode("http://127.0.0.1:1", "t", key, refused), false, "a refusal is not an unlock");
});
