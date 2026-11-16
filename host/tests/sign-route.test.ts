// /p/sign/<token>/: the public door of built-in signing. A real HTTP server with the real public-path route in front of the signing route and a scripted module behind it.
// What is proved: the page is the same for every token and reads nothing; every bad token is one byte-identical answer; a change of state is only a JSON POST; limits per token and per address;
// no cookie in, none out; no framing; nothing cached; an internal failure never leaks a word.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createPublicPathRoute } from "../src/routes/public-path.ts";
import { createSignRoute, REFUSAL } from "../src/routes/sign-route.ts";
import { signAsset, signShell } from "../src/routes/sign-page.ts";

const GOOD = "A".repeat(43);
const OTHER = "B".repeat(43);
const calls: { cap: string; input: Record<string, unknown> }[] = [];
let script: (cap: string, input: Record<string, unknown>) => unknown = () => ({});
let clock = 1_000_000;

const sign = createSignRoute({
  call: async (cap, input) => {
    calls.push({ cap, input });
    return script(cap, input);
  },
  shell: signShell,
  asset: signAsset,
  now: () => clock,
});
const route = createPublicPathRoute({ forms: () => null, origin: () => null, sign: () => sign });
const server = http.createServer((req, res) => {
  if (!route.handle(req, res)) {
    res.writeHead(404);
    res.end("outside /p");
  }
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
test.after(() => server.close());
test.beforeEach(() => {
  calls.length = 0;
  script = () => ({});
  clock += 10 * 60_000; // a fresh minute for every test
});

const bad = (code: string, message = "x"): Error => Object.assign(new Error(message), { error: { code, message } });
const j = (body: unknown = {}, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

test("the page is the same bytes for every token and opening it reads and changes nothing", async () => {
  const a = await fetch(`${base}/p/sign/${GOOD}/`);
  const b = await fetch(`${base}/p/sign/${OTHER}/`);
  assert.equal(a.status, 200);
  assert.equal(await a.text(), await b.text());
  assert.equal(calls.length, 0, "no capability was called");
  assert.match(a.headers.get("content-type") ?? "", /text\/html/);
  const head = await fetch(`${base}/p/sign/${GOOD}/`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(calls.length, 0);
  const css = await fetch(`${base}/p/sign/${GOOD}/assets/sign.css`);
  assert.equal(css.status, 200);
  assert.equal((await fetch(`${base}/p/sign/${GOOD}/assets/..%2Fsecret`)).status, 404);
  assert.equal((await fetch(`${base}/p/sign/${GOOD}/assets/nope.js`)).status, 404);
  assert.equal(calls.length, 0);
});

test("every answer stops framing and caching, carries the sandbox, never a cookie, and a cookie sent in is never read", async () => {
  script = (cap) => (cap === "esign.signer_view" ? { session: { state: "ready" } } : {});
  for (const r of [
    await fetch(`${base}/p/sign/${GOOD}/`),
    await fetch(`${base}/p/sign/${GOOD}/assets/sign.js`),
    await fetch(`${base}/p/sign/${GOOD}/view`, j({}, { cookie: "session=secret", authorization: "Bearer nope" })),
    await fetch(`${base}/p/sign/short/`),
    await fetch(`${base}/p/sign/${GOOD}/nothing`),
  ]) {
    assert.match(r.headers.get("cache-control") ?? "", /no-store|max-age=300/);
    assert.equal(r.headers.get("x-frame-options"), "DENY");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("referrer-policy"), "no-referrer");
    assert.equal(r.headers.get("set-cookie"), null);
    const csp = r.headers.get("content-security-policy") ?? "";
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /sandbox allow-scripts/);
    assert.ok(!/allow-same-origin/.test(csp), "the page never shares the Space's origin");
    await r.arrayBuffer();
  }
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]!.input).sort(), ["token", "visitor"], "no cookie or header went to the module");
});

test("a wrong token of any kind is one byte-identical refusal with no detail", async () => {
  script = () => Promise.reject(bad("auth.bad_credentials", "the module's own words"));
  const answers = new Set<string>();
  const seen: number[] = [];
  const tries: (() => Promise<Response>)[] = [
    () => fetch(`${base}/p/sign/${"x".repeat(42)}/view`, j()), // short
    () => fetch(`${base}/p/sign/${"x".repeat(44)}/view`, j()), // long
    () => fetch(`${base}/p/sign/${"x".repeat(42)}$/view`, j()), // bad character
    () => fetch(`${base}/p/sign/${GOOD}/view`, j()), // shape fine, module refuses
    () => fetch(`${base}/p/sign/${GOOD}/doc`),
    () => fetch(`${base}/p/sign/${GOOD}/sign`, j({ name: "A" })),
    () => fetch(`${base}/p/sign/${GOOD}/copy`, j()),
    () => fetch(`${base}/p/sign/${GOOD}/nowhere`, j()),
    () => fetch(`${base}/p/sign/${GOOD}/assets/nope.js`),
  ];
  for (const t of tries) {
    const r = await t();
    seen.push(r.status);
    answers.add(await r.text());
  }
  assert.deepEqual([...new Set(seen)], [404]);
  assert.equal(answers.size, 1);
  const body = JSON.parse([...answers][0]!) as { error: { code: string; message: string } };
  assert.deepEqual(body, { error: { code: "link.invalid", message: REFUSAL } });
  assert.ok(!JSON.stringify(body).includes("the module's own words"));
  const page = await fetch(`${base}/p/sign/short/`);
  assert.equal(page.status, 404);
  assert.match(await page.text(), /This link is not valid/);
});

test("state changes only by a JSON POST: a GET, a form post and a text post do nothing", async () => {
  script = () => ({ result: { state: "signed" } });
  for (const p of ["sign", "decline", "copy", "view"]) {
    const get = await fetch(`${base}/p/sign/${GOOD}/${p}`);
    assert.equal(get.status, 404, `GET ${p}`);
    const form = await fetch(`${base}/p/sign/${GOOD}/${p}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=A&consent=true",
    });
    assert.equal(form.status, 415, `form POST ${p}`);
    const text = await fetch(`${base}/p/sign/${GOOD}/${p}`, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
    assert.equal(text.status, 415, `text POST ${p}`);
    assert.equal((await fetch(`${base}/p/sign/${GOOD}/${p}`, { method: "PUT", headers: { "content-type": "application/json" }, body: "{}" })).status, 405);
  }
  assert.equal((await fetch(`${base}/p/sign/${GOOD}/doc`, { method: "POST", ...j() })).status, 404);
  assert.equal(calls.length, 0, "nothing reached the module");
  const ok = await fetch(`${base}/p/sign/${GOOD}/sign`, j({ name: "Andrea Lindahl", consent: true, signature: { kind: "typed", text: "Andrea Lindahl" } }));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { data: { state: "signed" } });
  assert.deepEqual(calls[0]!.input.body, { name: "Andrea Lindahl", consent: true, signature: { kind: "typed", text: "Andrea Lindahl" } });
  assert.equal(calls[0]!.input.op, "sign");
  assert.equal(calls[0]!.input.token, GOOD);
});

test("a body that is not JSON, an array, or over a megabyte is turned away before the module", async () => {
  for (const body of ["not json", "[1,2]", "null"]) {
    const r = await fetch(`${base}/p/sign/${GOOD}/sign`, { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.equal(r.status, 400, body);
  }
  const big = await fetch(`${base}/p/sign/${GOOD}/sign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ x: "y".repeat(1_100_000) }) });
  assert.equal(big.status, 413);
  assert.equal(calls.length, 0);
});

test("the visitor the relay saw reaches the module as the address, with the browser name; a relay header never lets a caller pick another address", async () => {
  script = () => ({ session: { state: "ready" } });
  await fetch(`${base}/p/sign/${GOOD}/view`, j({}, { "x-vyre-visitor": "203.0.113.9", "user-agent": "TestBrowser/1", "x-forwarded-for": "198.51.100.1" }));
  assert.deepEqual(calls[0]!.input.visitor, { ip: "203.0.113.9", ua: "TestBrowser/1" });
});

test("what the module refuses in plain words is shown in those words; anything else is a calm try again with no internal word", async () => {
  script = () => Promise.reject(bad("validation.bad_input", "Tick the box to agree to sign electronically."));
  const a = await fetch(`${base}/p/sign/${GOOD}/sign`, j({}));
  assert.equal(a.status, 422);
  assert.deepEqual(await a.json(), { error: { code: "validation.bad_input", message: "Tick the box to agree to sign electronically." } });
  script = () => Promise.reject(new Error("SQLITE_BUSY: database is locked at /srv/data/space.db"));
  const b = await fetch(`${base}/p/sign/${GOOD}/view`, j({}));
  assert.equal(b.status, 503);
  const text = await b.text();
  assert.ok(!/SQLITE|space\.db|srv/.test(text));
  assert.match(text, /Try again in a minute/);
});

test("the PDF is served as a PDF to a live link only", async () => {
  script = () => ({ base64: Buffer.from("%PDF-1.7 hello").toString("base64") });
  const r = await fetch(`${base}/p/sign/${GOOD}/doc`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "application/pdf");
  assert.equal(await r.text(), "%PDF-1.7 hello");
  script = () => Promise.reject(bad("auth.bad_credentials"));
  assert.equal((await fetch(`${base}/p/sign/${GOOD}/doc`)).status, 404);
});

test("a signer's own copy comes back as a PDF file, or 202 while it is being made", async () => {
  script = () => ({ result: { state: "done", base64: Buffer.from("%PDF-1.7 signed").toString("base64") } });
  const done = await fetch(`${base}/p/sign/${GOOD}/copy`, j());
  assert.equal(done.status, 200);
  assert.equal(done.headers.get("content-type"), "application/pdf");
  assert.match(done.headers.get("content-disposition") ?? "", /attachment/);
  script = () => ({ result: { state: "waiting" } });
  const wait = await fetch(`${base}/p/sign/${GOOD}/copy`, j());
  assert.equal(wait.status, 202);
  assert.deepEqual(await wait.json(), { data: { state: "waiting" } });
});

test("a token is limited to 60 tries a minute, an address to 150, and an address that keeps guessing is shut out", async () => {
  script = () => ({ session: { state: "ready" } });
  const statuses: number[] = [];
  for (let i = 0; i < 62; i++) statuses.push((await fetch(`${base}/p/sign/${GOOD}/view`, j())).status);
  assert.equal(statuses.filter((s) => s === 200).length, 60);
  assert.deepEqual(statuses.slice(60), [429, 429]);
  const limited = await fetch(`${base}/p/sign/${GOOD}/view`, j());
  assert.equal(limited.headers.get("retry-after"), "60");
  assert.deepEqual(await limited.json(), { error: { code: "rate_limit.exceeded", message: "Too many tries. Wait a minute and try again." } });
  assert.equal((await fetch(`${base}/p/sign/${OTHER}/view`, j())).status, 200, "another token is not held up by the first one's count");
  clock += 61_000;
  assert.equal((await fetch(`${base}/p/sign/${GOOD}/view`, j())).status, 200, "a minute later it is open again");
  // guessing: the module keeps refusing, so the address is shut out after 20 refusals
  script = () => Promise.reject(bad("auth.bad_credentials"));
  clock += 61_000;
  const guesses: number[] = [];
  for (let i = 0; i < 24; i++) guesses.push((await fetch(`${base}/p/sign/${String.fromCharCode(97 + (i % 26)).repeat(43)}/view`, j({}, { "x-vyre-visitor": "198.51.100.77" }))).status);
  assert.ok(guesses.includes(429), "an address that keeps guessing is stopped");
  assert.equal(guesses[0], 404);
  script = () => ({ session: { state: "ready" } });
  assert.equal((await fetch(`${base}/p/sign/${GOOD}/view`, j({}, { "x-vyre-visitor": "203.0.113.50" }))).status, 200, "another address is not affected");
});

test("signing and declining are held to 12 an address a minute", async () => {
  script = () => ({ result: { state: "signed" } });
  const out: number[] = [];
  for (let i = 0; i < 14; i++) out.push((await fetch(`${base}/p/sign/${String.fromCharCode(97 + i).repeat(43)}/sign`, j({}, { "x-vyre-visitor": "203.0.113.77" }))).status);
  assert.equal(out.filter((s) => s === 200).length, 12);
  assert.deepEqual(out.slice(12), [429, 429]);
});

test("the preflight a browser makes before a JSON post is answered, and the address without a slash is sent to the one with", async () => {
  const pre = await fetch(`${base}/p/sign/${GOOD}/sign`, { method: "OPTIONS" });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "*");
  assert.match(pre.headers.get("access-control-allow-headers") ?? "", /content-type/);
  const slash = await fetch(`${base}/p/sign/${GOOD}`, { redirect: "manual" });
  assert.equal(slash.status, 308);
  assert.equal(slash.headers.get("location"), `/p/sign/${GOOD}/`);
  assert.equal(calls.length, 0);
});

test("the page script puts what the server sends on the page as text, never as markup", () => {
  const js = new TextDecoder().decode(signAsset("sign.js")!.bytes);
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(js));
  assert.ok(!/localStorage|sessionStorage|document\.cookie|indexedDB/.test(js), "no storage and no cookie");
  assert.ok(!/https?:\/\//.test(js.replace(/\/\/ .*/g, "")), "no address outside the page");
});
