// providers.test reaches a local model at an address the caller chose, so the address is checked first (SSRF): cloud metadata and link-local never; loopback and private networks only on the caller's own computer.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { blockedAddress, createProviderProbe, pinnedGet, refuseModelAddress } from "../src/seams/vault.ts";
import type { PinnedRequest } from "../src/seams/vault.ts";

// the slow runner sets VYRE_TEST_KEY_CHECK=accept for live tests; this file tests the real probe
process.env["VYRE_TEST_KEY_CHECK"] = "real";

const KEY = "sk-local-NEVER-IN-AN-ANSWER";
const probeOn = (own: boolean, resolve: Record<string, string[]> = {}) => {
  const requested: { url: string; ips: readonly string[]; headers: Record<string, string> }[] = [];
  const request = (async (url: URL, o: { headers: Record<string, string>; ips: readonly string[] }) => { requested.push({ url: url.href, ips: o.ips, headers: o.headers }); return { status: 200, ok: true, json: async () => ({ data: [{ id: "llama3" }] }) }; }) as PinnedRequest;
  const probe = createProviderProbe({ request, own: () => own, resolve: async (h) => resolve[h] ?? (() => { throw new Error("no such host"); })() });
  return { probe, fetched: requested };
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
  assert.deepEqual(fetched[0]!.ips, ["93.184.216.34"], "it connects to the address it checked");
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

test("DNS rebinding: a name that answers differently the second time is not looked up again; the socket goes to the checked address", async () => {
  let lookups = 0;
  const request = (async () => ({ status: 200, ok: true, json: async () => ({ data: [] }) })) as PinnedRequest;
  const seen: (readonly string[])[] = [];
  const probe = createProviderProbe({
    own: () => false, request: (async (u: URL, o: { headers: Record<string, string>; ips: readonly string[] }) => { seen.push(o.ips); return request(u, o); }) as PinnedRequest,
    resolve: async () => (++lookups === 1 ? ["93.184.216.34"] : ["169.254.169.254"]),
  });
  const r = await ask(probe, "http://rebind.example:11434");
  assert.equal(r.ok, true);
  assert.equal(lookups, 1, "the name is resolved once");
  assert.deepEqual(seen, [["93.184.216.34"]], "and the connection is pinned to that answer");
});

test("pinnedGet connects to the pinned address and keeps the name as the Host header, and does not follow a redirect", async () => {
  const seenHost: string[] = [];
  const server = http.createServer((req, res) => {
    seenHost.push(String(req.headers["host"]));
    if (req.url === "/redir/v1/models") { res.writeHead(302, { location: "http://169.254.169.254/" }); res.end(); return; }
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ data: [{ id: "m1" }] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  try {
    // the name does not resolve anywhere real: only the pin gets the request to this server
    const ok = await pinnedGet(new URL(`http://model.invalid:${port}/v1/models`), { headers: {}, ips: ["127.0.0.1"] });
    assert.deepEqual([ok.status, ok.ok, await ok.json()], [200, true, { data: [{ id: "m1" }] }]);
    assert.deepEqual(seenHost, [`model.invalid:${port}`]);
    const redirected = await pinnedGet(new URL(`http://model.invalid:${port}/redir/v1/models`), { headers: {}, ips: ["127.0.0.1"] });
    assert.deepEqual([redirected.status, redirected.ok], [302, false], "a redirect is an answer, not a request to follow");
  } finally { server.close(); }
});

test("a provider key is only sent to its own provider, and a refused key says so without the key", async () => {
  const seen: string[] = [];
  const fetchFn = (async (url: string, init?: { headers?: Record<string, string> }) => { seen.push(`${url} ${JSON.stringify(init?.headers)}`); return new Response("{}", { status: 401 }); }) as unknown as typeof fetch;
  const r = await createProviderProbe({ fetch: fetchFn })({ providerKey: "anthropic", connection: "api_key", caller: "usr_a", apiKey: KEY });
  assert.deepEqual([r.ok, r.detail, r.refused], [false, "The provider did not accept this key.", true]);
  assert.ok(!JSON.stringify(r).includes(KEY));
  assert.match(seen[0]!, /^https:\/\/api\.anthropic\.com\/v1\/models/);
});

test("only a 401 or 403 is a refused key; a 5xx or a provider it cannot reach is not", async () => {
  const answering = (status: number) => (async () => new Response("{}", { status })) as unknown as typeof fetch;
  const probe = (f: typeof fetch) => createProviderProbe({ fetch: f })({ providerKey: "anthropic", connection: "api_key", caller: "usr_a", apiKey: KEY });
  assert.equal((await probe(answering(403))).refused, true);
  const busy = await probe(answering(503));
  assert.deepEqual([busy.ok, busy.refused, busy.detail], [false, undefined, "The provider answered 503."]);
  const down = await probe((async () => { throw new Error("getaddrinfo ENOTFOUND"); }) as unknown as typeof fetch);
  assert.deepEqual([down.ok, down.refused, down.detail], [false, undefined, "The provider could not be reached."]);
});

test("blockedAddress: the shared list refuses reserved and wrapped forms, on the own computer too where they are never right", () => {
  for (const ip of ["224.0.0.1", "255.255.255.255", "198.18.0.1", "192.0.0.5", "ff02::1", "64:ff9b:1::1", "::ffff:e000:1"]) {
    assert.ok(blockedAddress(ip, false), `${ip} off the own computer`);
    assert.ok(blockedAddress(ip, true), `${ip} on the own computer`);
  }
  for (const ip of ["100.64.0.1", "::", "::ffff:6440:1", "2002:6440:1::1", "64:ff9b::6440:1"]) assert.ok(blockedAddress(ip, false), `${ip} off the own computer`);
  assert.equal(blockedAddress("8.8.8.8", false), null);
});

test("a custom endpoint is probed at its own base (/models, its key as a bearer), through the same guard; OpenCode Go at its own model list", async () => {
  const { probe, fetched } = probeOn(false, { "llm.acme.test": ["93.184.216.34"] });
  const custom = await probe({ providerKey: "custom-acme", engine: "custom", connection: "api_key", caller: "usr_a", apiKey: KEY, address: "https://llm.acme.test/v1" });
  assert.deepEqual([custom.ok, custom.models], [true, ["llama3"]]);
  assert.deepEqual(fetched.map((f) => [f.url, f.headers["authorization"] === `Bearer ${KEY}`]), [["https://llm.acme.test/v1/models", true]]);
  const meta = await probe({ providerKey: "custom-evil", engine: "custom", connection: "api_key", caller: "usr_a", apiKey: KEY, address: "http://169.254.169.254/v1" });
  assert.equal(meta.ok, false);
  assert.equal(fetched.length, 1, "a refused address is never fetched");
  const urls: string[] = [];
  const go = createProviderProbe({ fetch: (async (u: string) => { urls.push(u); return { status: 200, ok: true, json: async () => ({ data: [{ id: "glm-5.3" }] }) }; }) as unknown as typeof fetch });
  assert.deepEqual((await go({ providerKey: "opencode-go", connection: "api_key", caller: "usr_a", apiKey: KEY })).models, ["glm-5.3"]);
  assert.deepEqual(urls, ["https://opencode.ai/inference/go/v1/models", "https://opencode.ai/inference/go/openai/v1/chat/completions"], "the list, then a one-token chat");
});

test("OpenCode Go's check is a real one-token chat with vyre's user agent and a session id: listing alone passed while every chat failed", async () => {
  type Seen = { url: string; method: string; headers: Record<string, string>; body: unknown };
  const run = async (chat: (n: number) => { status: number; text: string }) => {
    const seen: Seen[] = [];
    let n = 0;
    const probe = createProviderProbe({
      fetch: (async (u: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
        seen.push({ url: u, method: init?.method ?? "GET", headers: init?.headers ?? {}, body: init?.body ? JSON.parse(init.body) : undefined });
        if (u.endsWith("/v1/models")) return { status: 200, ok: true, json: async () => ({ data: [{ id: "kimi-k2" }, { id: "glm-5.3" }] }), text: async () => "" };
        const a = chat(n++);
        return { status: a.status, ok: a.status >= 200 && a.status < 300, json: async () => JSON.parse(a.text), text: async () => a.text };
      }) as unknown as typeof fetch,
    });
    return { r: await probe({ providerKey: "opencode-go", connection: "api_key", caller: "usr_a", apiKey: KEY }), seen };
  };
  const good = await run(() => ({ status: 200, text: JSON.stringify({ choices: [{ message: { content: "ok" } }] }) }));
  assert.deepEqual([good.r.ok, good.r.models], [true, ["kimi-k2", "glm-5.3"]]);
  const list = good.seen[0]!, chat = good.seen[1]!;
  assert.match(list.headers["user-agent"] ?? "", /^vyre\/[\w.+-]+$/, "the list carries vyre's user agent");
  assert.equal(chat.method, "POST");
  assert.match(chat.headers["user-agent"] ?? "", /^vyre\/[\w.+-]+$/);
  assert.ok((chat.headers["x-opencode-session"] ?? "").length > 0, "and a session id");
  assert.equal(chat.headers["authorization"], `Bearer ${KEY}`);
  assert.deepEqual(chat.body, { model: "kimi-k2", max_tokens: 1, stream: false, messages: [{ role: "user", content: "Say ok." }] });

  const missing = await run(() => ({ status: 400, text: JSON.stringify({ error: { type: "MissingSessionID", message: "Request is missing x-opencode-session" } }) }));
  assert.deepEqual([missing.r.ok, missing.r.refused, missing.r.detail], [false, undefined, "OpenCode Go turned the chat away because it carried no session id."], "a failed chat fails the check, in words, without calling the key refused");
  const refused = await run(() => ({ status: 401, text: "{}" }));
  assert.deepEqual([refused.r.ok, refused.r.refused], [false, true]);
  const second = await run((n) => (n === 0 ? { status: 404, text: "{}" } : { status: 200, text: "{}" }));
  assert.equal(second.r.ok, true, "a model this endpoint does not serve is tried past");
});

test("a Codex API key is checked with one cheap call to the OpenAI model list, and the key is in no answer", async () => {
  const seen: { url: string; auth: string | undefined }[] = [];
  const fetchFn = (async (url: string, init?: { headers?: Record<string, string> }) => { seen.push({ url, auth: init?.headers?.["authorization"] }); return { status: 200, ok: true, json: async () => ({ data: [{ id: "gpt-5-codex" }] }) }; }) as unknown as typeof fetch;
  const r = await createProviderProbe({ fetch: fetchFn })({ providerKey: "codex", connection: "api_key", caller: "usr_a", apiKey: KEY });
  assert.deepEqual([r.ok, r.models], [true, ["gpt-5-codex"]]);
  assert.deepEqual(seen, [{ url: "https://api.openai.com/v1/models", auth: `Bearer ${KEY}` }]);
  assert.ok(!JSON.stringify(r).includes(KEY));
});
