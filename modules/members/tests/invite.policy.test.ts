// Sign-in policy, the second-factor report and SSO providers (spec 3.13). TOTP itself is identity's; this is the Space rule around it. SSO is configured and tested here, secrets are Vault handles.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { codeOf, harness } from "../fixtures/db.ts";

const OFF = { secondFactor: "off" as const, requireSso: false, allowPassword: true, allowGithub: true };
const OKTA = { key: "okta" as const, title: "Okta", issuer: "https://dev-1.okta.com", clientId: "abc", clientSecretHandle: "#Okta_Secret", enabled: true };

test("the policy starts permissive, stores what is set, and names each changed rule once", async () => {
  const h = harness();
  const a = h.as("usr_admin");
  assert.deepEqual((await handlers["members.sign_in_policy.get"](a, {})).policy, OFF);
  h.world.factors.set("usr_admin", ["totp"]);
  h.world.factors.set("usr_owner", ["totp"]);
  h.events.length = 0;
  const out = await handlers["members.sign_in_policy.set"](a, { policy: { ...OFF, secondFactor: "required", allowGithub: false } });
  assert.deepEqual(out.policy, { secondFactor: "required", requireSso: false, allowPassword: true, allowGithub: false });
  assert.deepEqual((await handlers["members.sign_in_policy.get"](a, {})).policy, out.policy);
  assert.deepEqual(h.events.map((e) => e.payload), [
    { key: "sign_in.second_factor", scope: "space", kind: "sign_in", by: "usr_admin" },
    { key: "sign_in.allow_github", scope: "space", kind: "sign_in", by: "usr_admin" },
  ]);
  h.events.length = 0;
  await handlers["members.sign_in_policy.set"](a, { policy: out.policy });
  assert.equal(h.events.length, 0, "setting the same policy is quiet");
});

test("the owner floor: only the owner lowers a requirement, and nobody is locked out by their own change", async () => {
  const h = harness();
  const admin = h.as("usr_admin");
  await assert.rejects(handlers["members.sign_in_policy.set"](admin, { policy: { ...OFF, secondFactor: "required" } }), (e) => codeOf(e) === "validation.precondition_failed", "no factor of your own yet");
  h.world.factors.set("usr_admin", ["totp"]);
  h.world.factors.set("usr_owner", ["totp"]);
  await handlers["members.sign_in_policy.set"](admin, { policy: { ...OFF, secondFactor: "required" } });
  await assert.rejects(handlers["members.sign_in_policy.set"](admin, { policy: OFF }), (e) => codeOf(e) === "permission.role_lacks_permission");
  assert.equal((await handlers["members.sign_in_policy.get"](admin, {})).policy.secondFactor, "required");
  await handlers["members.sign_in_policy.set"](h.as("usr_owner"), { policy: OFF });
  assert.equal((await handlers["members.sign_in_policy.get"](admin, {})).policy.secondFactor, "off");
  await assert.rejects(handlers["members.sign_in_policy.set"](admin, { policy: { ...OFF, allowPassword: false, allowGithub: false } }), (e) => codeOf(e) === "validation.precondition_failed", "someone must be able to sign in");
  await assert.rejects(handlers["members.sign_in_policy.set"](admin, { policy: { ...OFF, requireSso: true } }), (e) => codeOf(e) === "validation.precondition_failed", "no provider yet");
});

test("the report puts the people without a second factor first", async () => {
  const h = harness();
  h.person("usr_bob", "Bob");
  h.person("usr_cara", "Cara");
  h.world.factors.set("usr_admin", ["totp"]);
  h.world.factors.set("usr_bob", ["totp"]);
  const out = await handlers["members.second_factor.report"](h.as("usr_admin"), {});
  assert.deepEqual(out.people.map((p) => [p.name, p.factors.length]), [["Cara", 0], ["Olive", 0], ["Ada", 1], ["Bob", 1]]);
  assert.deepEqual(out.people[0]!.person, { kind: "person", id: "usr_cara" });
  const page = await handlers["members.second_factor.report"](h.as("usr_admin"), { limit: 3 });
  assert.equal(page.people.length, 3);
  assert.equal(page.next, "3");
});

test("SSO providers: a Vault handle for the secret, https issuers, a list, and requiring SSO needs one that is on", async () => {
  const h = harness();
  const a = h.as("usr_admin");
  await assert.rejects(handlers["members.sso.set"](a, { provider: { ...OKTA, issuer: "http://dev-1.okta.com" } }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(handlers["members.sso.set"](a, { provider: { ...OKTA, issuer: "not a url" } }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(handlers["members.sso.set"](a, { provider: { ...OKTA, clientSecretHandle: "s3cr3t-value" } }), (e) => codeOf(e) === "validation.bad_input", "a secret value is never stored here");
  await assert.rejects(handlers["members.sso.set"](a, { provider: { ...OKTA, clientId: " " } }), (e) => codeOf(e) === "validation.bad_input");
  h.events.length = 0;
  const set = await handlers["members.sso.set"](a, { provider: { ...OKTA, issuer: "https://dev-1.okta.com/", domainHint: " Example.COM " } });
  assert.deepEqual(set.provider, { ...OKTA, domainHint: "example.com" });
  assert.deepEqual(h.events.map((e) => e.payload), [{ key: "sso.okta", scope: "space", kind: "sign_in", by: "usr_admin" }]);
  assert.ok(!JSON.stringify(h.raw.rows("members_policy")).includes("secret value"));
  assert.deepEqual((await handlers["members.sso.list"](a, {})).providers.map((p) => p.key), ["okta"]);
  await handlers["members.sign_in_policy.set"](a, { policy: { ...OFF, requireSso: true } });
  await assert.rejects(handlers["members.sso.set"](a, { provider: { ...OKTA, enabled: false } }), (e) => codeOf(e) === "validation.precondition_failed", "the only provider cannot be turned off while SSO is required");
  await assert.rejects(handlers["members.sso.remove"](a, { key: "okta" }), (e) => codeOf(e) === "validation.precondition_failed");
  await handlers["members.sso.set"](a, { provider: { key: "google", title: "Google", issuer: "https://accounts.google.com", clientId: "g", clientSecretHandle: "#Google.Secret", enabled: true } });
  await handlers["members.sso.remove"](a, { key: "okta" });
  assert.deepEqual((await handlers["members.sso.list"](a, {})).providers.map((p) => p.key), ["google"]);
  assert.deepEqual(await handlers["members.sso.remove"](a, { key: "okta" }), { ok: true }, "removing what is not there is fine");
});

test("the SSO test reads the discovery document and the signing keys and says what is wrong", async () => {
  const h = harness();
  const a = h.as("usr_admin");
  await assert.rejects(handlers["members.sso.test"](a, { key: "okta" }), (e) => codeOf(e) === "validation.not_found");
  await handlers["members.sso.set"](a, { provider: OKTA });
  const disco = "https://dev-1.okta.com/.well-known/openid-configuration";
  const good = { issuer: "https://dev-1.okta.com", authorization_endpoint: "https://dev-1.okta.com/a", token_endpoint: "https://dev-1.okta.com/t", jwks_uri: "https://dev-1.okta.com/keys" };
  h.world.http.set(disco, { status: 200, body: good });
  h.world.http.set(good.jwks_uri, { status: 200, body: { keys: [{ kid: "1" }, { kid: "2" }] } });
  const ok = await handlers["members.sso.test"](a, { key: "okta" });
  assert.equal(ok.ok, true);
  assert.match(ok.detail!, /2 signing keys found.*\/auth\/sso\/okta\/callback/);
  h.world.http.set(disco, { status: 200, body: { ...good, issuer: "https://other.example.com" } });
  assert.match((await handlers["members.sso.test"](a, { key: "okta" })).detail!, /different issuer/);
  h.world.http.set(disco, { status: 200, body: { ...good, jwks_uri: "http://dev-1.okta.com/keys" } });
  assert.match((await handlers["members.sso.test"](a, { key: "okta" })).detail!, /missing an https endpoint/);
  h.world.http.set(disco, { status: 404, body: {} });
  assert.deepEqual(await handlers["members.sso.test"](a, { key: "okta" }), { ok: false, detail: "the discovery document answered 404" });
  h.world.http.set(disco, { status: 200, body: good });
  h.world.http.set(good.jwks_uri, { status: 200, body: { keys: [] } });
  assert.match((await handlers["members.sso.test"](a, { key: "okta" })).detail!, /no signing keys/);
  h.world.http.delete(good.jwks_uri);
  const down = await handlers["members.sso.test"](a, { key: "okta" });
  assert.equal(down.ok, false);
  assert.match(down.detail!, /could not read the provider/);
});
