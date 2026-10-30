// Each provider's sign-in against stubbed endpoints: the link the person is given, what is sent back when the code is pasted or the person has approved, what a refusal says, and that the flow belongs to one person.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CLAUDE, CODEX, createProviderSignin, collectGrokFiles } from "./provider-signin.ts";
import type { SeamFetch } from "./ports.ts";

interface Call { url: string; method: string; body: string }
function stub(handler: (c: Call) => { status: number; body?: unknown }): { fetch: SeamFetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: SeamFetch = async (url, init) => {
    const c = { url, method: init?.method ?? "GET", body: String(init?.body ?? "") };
    calls.push(c);
    const r = handler(c);
    return { status: r.status, text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {})), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  return { fetch, calls };
}
const TOKEN = "sk-ant-oat01-stubTOKENvalue0123456789abcdefXYZ"; // secret-scan: fake

test("claude: the link carries the PKCE challenge of a verifier only the server knows, and the pasted code is exchanged for the token", async () => {
  const s = stub(() => ({ status: 200, body: { access_token: TOKEN, token_type: "Bearer", expires_in: CLAUDE.lifetimeSec } }));
  const port = createProviderSignin({ fetch: s.fetch });
  const started = await port.start({ id: "sub_1", provider: "claude-code", person: "usr_a" });
  assert.equal(started.needsCode, true);
  assert.equal(started.userCode, undefined);
  const u = new URL(started.url);
  assert.equal(`${u.origin}${u.pathname}`, CLAUDE.authorize);
  assert.equal(u.searchParams.get("client_id"), CLAUDE.clientId);
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("redirect_uri"), CLAUDE.redirect);
  assert.equal(u.searchParams.get("scope"), "user:inference");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  const state = u.searchParams.get("state")!;
  assert.ok(state.length >= 24);
  assert.equal(port.active("sub_1"), true);
  assert.deepEqual(await port.step({ id: "sub_1", person: "usr_a" }), { state: "waiting" }, "no code yet, nothing is sent");
  assert.equal(s.calls.length, 0);

  const done = await port.step({ id: "sub_1", person: "usr_a", code: `AUTHCODE123456#${state}` });
  assert.deepEqual(done, { state: "done", fields: [{ key: "setup_token", value: TOKEN, secret: true }] });
  const sent = JSON.parse(s.calls[0]!.body) as Record<string, unknown>;
  assert.equal(s.calls[0]!.url, CLAUDE.token);
  assert.equal(sent["grant_type"], "authorization_code");
  assert.equal(sent["code"], "AUTHCODE123456");
  assert.equal(sent["state"], state);
  assert.equal(sent["redirect_uri"], CLAUDE.redirect);
  assert.equal(sent["expires_in"], CLAUDE.lifetimeSec);
  // the verifier sent is the one whose hash is in the link
  assert.equal(crypto.createHash("sha256").update(String(sent["code_verifier"])).digest("base64url"), u.searchParams.get("code_challenge"));
  assert.equal(port.active("sub_1"), false, "a finished flow is gone");
});

test("claude: a code from another sign-in, a malformed paste and a refusal each say what to do, and the credential is never in the words", async () => {
  let status = 200;
  const s = stub(() => ({ status, body: status === 200 ? { access_token: "not-a-token" } : { error: `bad ${TOKEN}` } }));
  const port = createProviderSignin({ fetch: s.fetch });
  const begin = async (id: string): Promise<string> => new URL((await port.start({ id, provider: "claude-code", person: "usr_a" })).url).searchParams.get("state")!;
  const a = await begin("sub_a");
  assert.match(((await port.step({ id: "sub_a", person: "usr_a", code: "CODE123456#someOtherState12345" })) as { message: string }).message, /different sign-in/);
  const b = await begin("sub_b");
  assert.match(((await port.step({ id: "sub_b", person: "usr_a", code: "no spaces allowed" })) as { message: string }).message, /does not look like the code/);
  const c = await begin("sub_c");
  status = 400;
  const refused = (await port.step({ id: "sub_c", person: "usr_a", code: `CODE123456#${c}` })) as { message: string };
  assert.match(refused.message, /did not accept that code/);
  assert.equal(refused.message.includes(TOKEN), false);
  const d = await begin("sub_d");
  status = 200;
  assert.match(((await port.step({ id: "sub_d", person: "usr_a", code: `CODE123456#${d}` })) as { message: string }).message, /not a sign-in token/);
  void a; void b;
});

test("claude: a flow answers only to the person who started it, and ends after fifteen minutes", async () => {
  let t = 1_000;
  const port = createProviderSignin({ fetch: stub(() => ({ status: 200, body: { access_token: TOKEN } })).fetch, now: () => t });
  const state = new URL((await port.start({ id: "sub_p", provider: "claude-code", person: "usr_a" })).url).searchParams.get("state")!;
  assert.deepEqual(await port.step({ id: "sub_p", person: "usr_b", code: `CODE123456#${state}` }), { state: "failed", message: "That sign-in is over. Start again." });
  t += 16 * 60_000;
  assert.equal((await port.step({ id: "sub_p", person: "usr_a", code: `CODE123456#${state}` })).state, "failed");
  assert.equal(port.active("sub_p"), false);
});

function codexHandler(approveAfter: number) {
  let polls = 0;
  return (c: Call): { status: number; body?: unknown } => {
    if (c.url.endsWith("/api/accounts/deviceauth/usercode")) return { status: 200, body: { device_auth_id: "dev_1", user_code: "ABCD-1234", interval: "5" } };
    if (c.url.endsWith("/api/accounts/deviceauth/token")) return ++polls <= approveAfter ? { status: 403, body: { error: "authorization_pending" } } : { status: 200, body: { authorization_code: "AC-1", code_challenge: "x", code_verifier: "VER-1" } };
    if (c.url.endsWith("/oauth/token")) {
      const idToken = `h.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct_9" } })).toString("base64url")}.s`;
      return { status: 200, body: { id_token: idToken, access_token: "at-codex-1", refresh_token: "rt-codex-1" } };
    }
    return { status: 404 };
  };
}

test("codex: the person gets the device page and a code, polling waits while it is pending, then the files the CLI keeps are made", async () => {
  let t = 10_000;
  const s = stub(codexHandler(1));
  const port = createProviderSignin({ fetch: s.fetch, now: () => t });
  const started = await port.start({ id: "sub_x", provider: "codex", person: "usr_a" });
  assert.deepEqual(started, { url: CODEX.verifyPage, userCode: "ABCD-1234", needsCode: false, expiresInSec: 900 });
  assert.equal(JSON.parse(s.calls[0]!.body).client_id, CODEX.clientId);
  assert.deepEqual(await port.step({ id: "sub_x", person: "usr_a" }), { state: "waiting" }, "polling is not faster than the interval");
  assert.equal(s.calls.length, 1);
  t += 6_000;
  assert.deepEqual(await port.step({ id: "sub_x", person: "usr_a" }), { state: "waiting" }, "still pending: 403");
  t += 6_000;
  const done = await port.step({ id: "sub_x", person: "usr_a" });
  assert.equal(done.state, "done");
  if (done.state !== "done") return;
  assert.equal(done.fields[0]!.key, "credentials");
  const files = JSON.parse(done.fields[0]!.value) as Record<string, string>;
  const auth = JSON.parse(files[".codex/auth.json"]!) as { tokens: Record<string, string>; OPENAI_API_KEY: null };
  assert.deepEqual([auth.tokens["access_token"], auth.tokens["refresh_token"], auth.tokens["account_id"]], ["at-codex-1", "rt-codex-1", "acct_9"]);
  const exchange = s.calls.at(-1)!;
  assert.equal(exchange.url, `${CODEX.issuer}/oauth/token`);
  const form = new URLSearchParams(exchange.body);
  assert.deepEqual([form.get("grant_type"), form.get("code"), form.get("code_verifier"), form.get("redirect_uri"), form.get("client_id")], ["authorization_code", "AC-1", "VER-1", `${CODEX.issuer}/deviceauth/callback`, CODEX.clientId]);
});

test("codex: a provider that cannot start the sign-in, and a refusal at the end, say so in words", async () => {
  const none = createProviderSignin({ fetch: stub(() => ({ status: 404 })).fetch });
  await assert.rejects(() => none.start({ id: "sub_n", provider: "codex", person: "usr_a" }), /device sign-in/);
  assert.equal(none.active("sub_n"), false);
  let t = 0;
  const bad = createProviderSignin({ fetch: stub((c) => (c.url.endsWith("usercode") ? { status: 200, body: { device_auth_id: "d", user_code: "AAAA-1111", interval: 1 } } : { status: 500 })).fetch, now: () => t });
  await bad.start({ id: "sub_m", provider: "codex", person: "usr_a" });
  t += 5_000;
  assert.match(((await bad.step({ id: "sub_m", person: "usr_a" })) as { message: string }).message, /did not finish the sign-in \(500\)/);
});

test("grok: the address and code the command prints are shown, and the files it leaves are the credential, then the home is deleted", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-test-grok-"));
  fs.mkdirSync(path.join(home, ".grok"));
  fs.writeFileSync(path.join(home, ".grok", "auth.json"), '{"token":"grok-secret-xyz"}');
  fs.mkdirSync(path.join(home, ".cache"));
  fs.writeFileSync(path.join(home, ".cache", "junk"), "x");
  const proc = { text: "", url: "https://accounts.x.ai/device?x=1", code: "WXYZ-5678", ended: false, exitCode: null as number | null, home, kill: () => undefined };
  const port = createProviderSignin({ fetch: stub(() => ({ status: 500 })).fetch, spawnGrok: () => proc });
  const started = await port.start({ id: "sub_g", provider: "grok", person: "usr_a" });
  assert.deepEqual(started, { url: "https://accounts.x.ai/device?x=1", userCode: "WXYZ-5678", needsCode: false, expiresInSec: 900 });
  assert.deepEqual(await port.step({ id: "sub_g", person: "usr_a" }), { state: "waiting" });
  proc.ended = true; proc.exitCode = 0;
  const done = await port.step({ id: "sub_g", person: "usr_a" });
  assert.equal(done.state, "done");
  if (done.state !== "done") return;
  assert.deepEqual(JSON.parse(done.fields[0]!.value), { ".grok/auth.json": '{"token":"grok-secret-xyz"}' });
  assert.equal(fs.existsSync(home), false, "the private home is gone");
});

test("grok: a command that is not installed, or fails, says so and leaves nothing behind", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-test-grok-"));
  const missing = createProviderSignin({ fetch: stub(() => ({ status: 500 })).fetch, spawnGrok: () => ({ text: "spawn grok ENOENT", url: null, code: null, ended: true, exitCode: 127, home, kill: () => undefined }) });
  await assert.rejects(() => missing.start({ id: "sub_h", provider: "grok", person: "usr_a" }), /needs the Grok command line/);
  assert.equal(fs.existsSync(home), false);
  assert.deepEqual(collectGrokFiles(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-test-grok-"))), {});
});

test("a provider this server does not sign in is not offered", () => {
  const port = createProviderSignin({ fetch: stub(() => ({ status: 500 })).fetch });
  assert.equal(port.has("claude-code") && port.has("codex") && port.has("grok"), true);
  assert.equal(port.has("openai"), false);
});
