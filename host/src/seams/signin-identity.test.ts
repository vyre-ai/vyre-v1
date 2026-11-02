// Who a sign-in belongs to: read from the provider's own answer (Claude), its id token (Codex) or its files (Grok), never from a secret value, and null when nothing names the account.
import test from "node:test";
import assert from "node:assert/strict";
import { CLAUDE, createProviderSignin } from "./provider-signin.ts";
import { claudeIdentity, codexIdentity, grokIdentity, identityOfFields } from "./signin-identity.ts";
import type { SeamFetch } from "./ports.ts";

const jwt = (claims: Record<string, unknown>): string => `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const TOKEN = "sk-ant-oat01-identityTOKENvalue0123456789abcdef"; // secret-scan: fake

test("claude: the token answer's account and organization name the account; the email is what a person reads", () => {
  const a = claudeIdentity({ access_token: TOKEN, account: { uuid: "acc-1", email_address: "Dana@Example.com" }, organization: { uuid: "org-9", name: "Dana's Org" } });
  assert.deepEqual(a, { id: "claude:acct:acc-1/org:org-9", label: "dana@example.com" });
  const work = claudeIdentity({ account: { uuid: "acc-1", email_address: "dana@example.com" }, organization: { uuid: "org-work", name: "Work" } });
  assert.notEqual(work?.id, a?.id, "the same person in another organization is another account");
  assert.deepEqual(claudeIdentity({ organization: { uuid: "org-9", name: "Dana's Org" } }), { id: "claude:org:org-9", label: "Dana's Org" });
  assert.equal(claudeIdentity({ access_token: TOKEN }), null, "an answer that names nobody");
  assert.equal(claudeIdentity(null), null);
  assert.equal(JSON.stringify(a).includes(TOKEN), false, "the token is never part of an identity");
});

test("codex: the id token names the ChatGPT account (personal or a workspace) and the person; a broken token names nobody", () => {
  const personal = codexIdentity(jwt({ email: "dana@example.com", sub: "auth0|1", "https://api.openai.com/auth": { chatgpt_account_id: "acct-personal", chatgpt_user_id: "user-1" } }));
  const team = codexIdentity(jwt({ email: "dana@example.com", sub: "auth0|1", "https://api.openai.com/auth": { chatgpt_account_id: "acct-team", chatgpt_user_id: "user-1" } }));
  assert.deepEqual(personal, { id: "chatgpt:acct:acct-personal/user:user-1", label: "dana@example.com" });
  assert.notEqual(personal?.id, team?.id);
  assert.equal(codexIdentity("not-a-jwt"), null);
  assert.equal(codexIdentity(jwt({})), null);
});

test("grok: the files' id token or user id and email name the account; files that name nobody give null", () => {
  assert.deepEqual(grokIdentity({ ".grok/auth.json": JSON.stringify({ id_token: jwt({ sub: "x-user-7", email: "dana@example.com" }), access_token: "opaque-token-value-123" }) }), { id: "grok:user:x-user-7", label: "dana@example.com" });
  assert.deepEqual(grokIdentity({ "a.json": JSON.stringify({ user: { user_id: "u-2", email: "d@example.com" } }) }), { id: "grok:user:u-2", label: "d@example.com" });
  assert.equal(grokIdentity({ "a.json": JSON.stringify({ token: "opaque-token-value-123" }) }), null);
});

test("a saved sign-in's identity comes from its fields: Codex and Grok files name the account, a Claude setup token names nobody", () => {
  const auth = JSON.stringify({ tokens: { id_token: jwt({ email: "dana@example.com", "https://api.openai.com/auth": { chatgpt_account_id: "acct-1", chatgpt_user_id: "u-1" } }), access_token: "a", refresh_token: "r" } });
  assert.deepEqual(identityOfFields("codex", [{ key: "credentials", value: JSON.stringify({ ".codex/auth.json": auth }) }]), { id: "chatgpt:acct:acct-1/user:u-1", label: "dana@example.com" });
  assert.equal(identityOfFields("claude-code", [{ key: "setup_token", value: TOKEN }]), null);
  assert.equal(identityOfFields("codex", [{ key: "credentials", value: "not json" }]), null);
  assert.equal(identityOfFields("codex", [{ key: "credentials", value: JSON.stringify({ ".codex/auth.json": "{}" }) }]), null);
});

test("the Claude sign-in answers who it is with the token, so signing in again to the same account can refresh it", async () => {
  const fetch: SeamFetch = async () => ({ status: 200, text: async () => JSON.stringify({ access_token: TOKEN, account: { uuid: "acc-1", email_address: "dana@example.com" }, organization: { uuid: "org-9" } }), arrayBuffer: async () => new ArrayBuffer(0) });
  const port = createProviderSignin({ fetch });
  const started = await port.start({ id: "sub_1", provider: "claude-code", person: "usr_a" });
  const state = new URL(started.url).searchParams.get("state")!;
  assert.equal(new URL(started.url).origin + new URL(started.url).pathname, CLAUDE.authorize);
  const done = await port.step({ id: "sub_1", person: "usr_a", code: `AUTHCODE123456#${state}` });
  assert.deepEqual(done, { state: "done", fields: [{ key: "setup_token", value: TOKEN, secret: true }], identity: { id: "claude:acct:acc-1/org:org-9", label: "dana@example.com" } });
});
