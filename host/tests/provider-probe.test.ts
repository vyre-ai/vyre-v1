// providers.test reaches a local model at an address the caller chose, so the address is checked first (SSRF): cloud metadata and link-local never; loopback and private networks only on the caller's own computer.
import test from "node:test";
import assert from "node:assert/strict";
import { blockedAddress, createProviderProbe, refuseModelAddress } from "../src/seams/vault.ts";

const KEY = "sk-local-NEVER-IN-AN-ANSWER";
const probeOn = (own: boolean, resolve: Record<string, string[]> = {}) => {
  const fetched: { url: string; headers: Record<string, string> }[] = [];
  const fetchFn = (async (url: string, init?: { headers?: Record<string, string> }) => { fetched.push({ url: String(url), headers: init?.headers ?? {} }); return new Response(JSON.stringify({ data: [{ id: "llama3" }] })); }) as unknown as typeof fetch;
  const probe = createProviderProbe({ fetch: fetchFn, own: () => own, resolve: async (h) => resolve[h] ?? (() => { throw new Error("no such host"); })() });
  return { probe, fetched };
};
const ask = (probe: ReturnType<typeof probeOn>["probe"], address: string) => probe({ providerKey: "local", connection: "local_model", caller: "usr_a", apiKey: KEY, address });

test("blockedAddress: link-local is refused everywhere; loopback, private, unspecified and shared ranges only off the caller's own computer", () => {
  for (const own of [true, false]) {
    for (const ip of ["169.254.169.254", "169.254.0.1", "fe80::1", "febf::1", "::ffff:169.254.169.254"]) assert.ok(blockedAddress(ip, own), `${ip} (own ${own})`);
  }
  for (const ip of ["127.0.0.1", "127.9.9.9", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "0.0.0.0", "100.64.0.1", "::1", "::", "fc00::1", "fd12:3456::1", "::ffff:10.0.0.1", "::ffff:127.0.0.1"]) {
    assert.ok(blockedAddress(ip, false), `${ip} off the own computer`);
    assert.equal(blockedAddress(ip, true), null, `${ip} on the own computer`);
  }
  for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "172.15.0.1", "2606:4700::1"]) { assert.equal(blockedAddress(ip, false), null, ip); assert.equal(blockedAddress(ip, true), null, ip); }
});

test("a Space server refuses metadata, private and loopback addresses, by number or by name, and never fetches", async () => {
  const { probe, fetched } = probeOn(false, { "metadata.internal": ["169.254.169.254"], "box.lan": ["192.168.1.20"], "sneaky.example": ["93.184.216.34", "10.0.0.9"], "model.example": ["93.184.216.34"] });
  for (const address of ["http://169.254.169.254/latest", "http://10.0.0.5:11434", "http://172.20.0.2", "http://192.168.1.1", "http://127.0.0.1:11434", "http://localhost:11434".replace("localhost", "127.0.0.1"), "http://[::1]:11434", "http://0.0.0.0", "http://metadata.internal", "http://box.lan", "http://sneaky.example"]) {
    const r = await ask(probe, address);
    assert.equal(r.ok, false, address);
    assert.ok(!JSON.stringify(r).includes(KEY), "the key is never in an answer");
  }
  assert.deepEqual(fetched, [], "nothing was fetched");
  const fine = await ask(probe, "https://model.example:8443");
  assert.deepEqual([fine.ok, fine.models], [true, ["llama3"]]);
  assert.deepEqual(fetched.map((f) => f.url), ["https://model.example:8443/v1/models"]);
});

test("the caller's own computer may probe loopback and private addresses, but never link-local", async () => {
  const { probe, fetched } = probeOn(true, { "metadata.internal": ["169.254.169.254"] });
  assert.equal((await ask(probe, "http://127.0.0.1:11434")).ok, true);
  assert.equal((await ask(probe, "http://192.168.1.20:11434")).ok, true);
  assert.equal((await ask(probe, "http://169.254.169.254")).ok, false);
  assert.equal((await ask(probe, "http://metadata.internal")).ok, false);
  assert.deepEqual(fetched.map((f) => f.url), ["http://127.0.0.1:11434/v1/models", "http://192.168.1.20:11434/v1/models"]);
});

test("only http and https, a real address, and a name that resolves", async () => {
  assert.match(String(await refuseModelAddress("file:///etc/passwd", true)), /http or https/);
  assert.match(String(await refuseModelAddress("ftp://example.com", true)), /http or https/);
  assert.match(String(await refuseModelAddress("not a url", true)), /not an address/i);
  assert.match(String(await refuseModelAddress("http://nowhere.example", false, async () => { throw new Error("ENOTFOUND"); })), /could not be found/);
  assert.equal(await refuseModelAddress("http://model.example", false, async () => ["93.184.216.34"]), null);
});

test("redirects are errors: a model address that answers with a redirect is not followed", async () => {
  let init: { redirect?: string } = {};
  const probe = createProviderProbe({ fetch: (async (_u: string, i: { redirect?: string }) => { init = i; return new Response("", { status: 302 }); }) as unknown as typeof fetch, own: () => true });
  const r = await probe({ providerKey: "local", connection: "local_model", caller: "usr_a", address: "http://127.0.0.1:11434" });
  assert.equal(init.redirect, "error");
  assert.equal(r.ok, false);
});

test("a provider key is only sent to its own provider, and a refused key says so without the key", async () => {
  const seen: string[] = [];
  const fetchFn = (async (url: string, init?: { headers?: Record<string, string> }) => { seen.push(`${url} ${JSON.stringify(init?.headers)}`); return new Response("{}", { status: 401 }); }) as unknown as typeof fetch;
  const r = await createProviderProbe({ fetch: fetchFn })({ providerKey: "anthropic", connection: "api_key", caller: "usr_a", apiKey: KEY });
  assert.deepEqual([r.ok, r.detail], [false, "The provider did not accept this key."]);
  assert.ok(!JSON.stringify(r).includes(KEY));
  assert.match(seen[0]!, /^https:\/\/api\.anthropic\.com\/v1\/models/);
});
