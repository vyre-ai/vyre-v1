// Sign-in: password, TOTP and GitHub paths; pairing; sessions; passkey declared deferred (fork F-A).
// @reads ../migrations/0001_identity.sql
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handlers } from "../impl.ts";
import { codeOf, DEVICE, harness, NOW } from "./wire.ts";
import { SEED_PERSON } from "../fixtures/seed.ts";
import { provisionAccount, sessionOfToken, totpAt, unbase32 } from "../projections.ts";

const P = SEED_PERSON;

async function world() {
  const h = harness();
  await provisionAccount(h.anon, P);
  return h;
}
function secretOf(setupUri: string): string {
  const m = /secret=([A-Z2-7]+)/.exec(setupUri);
  assert.ok(m, "setup uri has a secret");
  return m[1]!;
}
const stepNow = (ms: number) => Math.floor(ms / 30_000);

test("every identity capability has a handler and the migration tables exist", () => {
  assert.equal(Object.keys(handlers).length, 26);
  const sql = readFileSync(new URL("../migrations/0001_identity.sql", import.meta.url), "utf8");
  for (const t of ["identity_space", "identity_accounts", "identity_sessions", "identity_challenges", "identity_codes", "identity_enrolments"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS "${t}"`));
  }
});

test("sign-in options and username check", async () => {
  const h = await world();
  const o = await handlers["identity.sign_in_options"](h.anon, {});
  assert.equal(o.name, "Maya Studio");
  assert.equal(o.fingerprint, "ab12 cd34 ef56 7890");
  assert.equal(o.password, true);
  assert.equal(o.github, true);
  assert.equal((await handlers["identity.username_available"](h.anon, { username: "maya" })).available, false);
  assert.equal((await handlers["identity.username_available"](h.anon, { username: "omar" })).available, true);
  assert.equal((await handlers["identity.username_available"](h.anon, { username: "Bad Name!" })).available, false);
});

test("password sign-in issues a session, stores only a token hash, and never echoes the password", async () => {
  const h = await world();
  const out = await handlers["identity.sign_in"](h.anon, { username: "Maya", password: P.secret, ...DEVICE });
  assert.equal(out.status, "ok");
  assert.ok(out.session);
  assert.match(out.session.token, /^vst_/);
  assert.equal(out.session.expiresAt, NOW + 30 * 24 * 3_600_000);
  assert.deepEqual(sessionOfToken(h.anon, out.session.token)?.personId, P.personId);
  const rows = h.db.all(`SELECT token_hash FROM identity_sessions`) as { token_hash: string }[];
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0]!.token_hash, out.session.token);
  assert.ok(h.events.some((e) => e.name === "signin.succeeded"));
  assert.ok(!JSON.stringify(h.events).includes(P.secret));
  assert.ok(!JSON.stringify(out).includes(P.secret));
  const stored = (h.db.all(`SELECT verifier FROM identity_accounts`) as { verifier: string }[])[0]!.verifier;
  assert.ok(stored.startsWith("argon2id$") && !stored.includes(P.secret));
});

test("wrong password and unknown user fail the same way; five misses lock the account", async () => {
  const h = await world();
  for (const username of ["maya", "nobody"]) {
    await assert.rejects(handlers["identity.sign_in"](h.anon, { username, password: "wrong wrong wrong", ...DEVICE }), (e) => codeOf(e) === "auth.bad_credentials");
  }
  for (let i = 0; i < 4; i++) await assert.rejects(handlers["identity.sign_in"](h.anon, { username: "maya", password: "wrong wrong wrong", ...DEVICE }), (e) => codeOf(e) === "auth.bad_credentials");
  // locked now: even the right password is refused
  await assert.rejects(handlers["identity.sign_in"](h.anon, { username: "maya", password: P.secret, ...DEVICE }), (e) => codeOf(e) === "auth.bad_credentials");
  const reasons = h.events.filter((e) => e.name === "signin.failed").map((e) => (e.payload as { reason: string }).reason);
  assert.ok(reasons.includes("locked"));
  assert.ok(reasons.includes("bad_credentials"));
  h.advance(16 * 60_000);
  const out = await handlers["identity.sign_in"](h.anon, { username: "maya", password: P.secret, ...DEVICE });
  assert.equal(out.status, "ok");
});

test("TOTP: enrol, then sign-in asks for the second factor and a code cannot be replayed", async () => {
  const h = await world();
  const ctx = h.as(P.personId);
  const begin = await handlers["identity.totp_begin"](ctx, {});
  const secret = secretOf(begin.setupUri);
  assert.ok(unbase32(secret).length === 20);
  const code = await totpAt(secret, stepNow(NOW));
  await assert.rejects(handlers["identity.totp_confirm"](ctx, { enrolmentId: begin.enrolmentId, code: "000000" }), (e) => codeOf(e) === "auth.invalid_code");
  await handlers["identity.totp_confirm"](ctx, { enrolmentId: begin.enrolmentId, code });
  assert.ok(h.events.some((e) => e.name === "factor.enrolled"));

  const first = await handlers["identity.sign_in"](h.anon, { username: "maya", password: P.secret, ...DEVICE });
  assert.equal(first.status, "second_factor_required");
  assert.ok(first.challengeId);
  assert.equal(first.session, undefined);
  assert.equal(first.keys, undefined);

  // the enrolment code's step is spent; the next step works
  h.advance(30_000);
  const next = await totpAt(secret, stepNow(NOW + 30_000));
  await assert.rejects(handlers["identity.verify_second_factor"](h.anon, { challengeId: first.challengeId!, code: "000000", ...DEVICE }), (e) => codeOf(e) === "auth.invalid_code");
  const done = await handlers["identity.verify_second_factor"](h.anon, { challengeId: first.challengeId!, code: next, ...DEVICE });
  assert.equal(done.status, "ok");
  assert.ok(done.session);
  // replay: same code, same step
  const again = await handlers["identity.sign_in"](h.anon, { username: "maya", password: P.secret, ...DEVICE });
  assert.equal(again.status, "second_factor_required");
  await assert.rejects(handlers["identity.verify_second_factor"](h.anon, { challengeId: again.challengeId!, code: next, ...DEVICE }), (e) => codeOf(e) === "auth.invalid_code");
  // a used challenge is dead
  await assert.rejects(handlers["identity.verify_second_factor"](h.anon, { challengeId: first.challengeId!, code: next, ...DEVICE }), (e) => codeOf(e) === "auth.invalid_code");

  // code inline with the password
  h.advance(30_000);
  const inline = await handlers["identity.sign_in"](h.anon, { username: "maya", password: P.secret, totp: await totpAt(secret, stepNow(NOW + 60_000)), ...DEVICE });
  assert.equal(inline.status, "ok");
  await assert.rejects(handlers["identity.sign_in"](h.anon, { username: "maya", password: P.secret, totp: "123456", ...DEVICE }), (e) => codeOf(e) === "auth.invalid_code");
});

test("a second-factor challenge expires", async () => {
  const h = await world();
  const ctx = h.as(P.personId);
  const begin = await handlers["identity.totp_begin"](ctx, {});
  const secret = secretOf(begin.setupUri);
  await handlers["identity.totp_confirm"](ctx, { enrolmentId: begin.enrolmentId, code: await totpAt(secret, stepNow(NOW)) });
  const first = await handlers["identity.sign_in"](h.anon, { username: "maya", password: P.secret, ...DEVICE });
  h.advance(6 * 60_000);
  await assert.rejects(handlers["identity.verify_second_factor"](h.anon, { challengeId: first.challengeId!, code: await totpAt(secret, stepNow(NOW + 6 * 60_000)), ...DEVICE }), (e) => codeOf(e) === "auth.expired");
});

test("TOTP can be removed with the password unless the Space requires it", async () => {
  const h = await world();
  const ctx = h.as(P.personId);
  const begin = await handlers["identity.totp_begin"](ctx, {});
  await handlers["identity.totp_confirm"](ctx, { enrolmentId: begin.enrolmentId, code: await totpAt(secretOf(begin.setupUri), stepNow(NOW)) });
  await assert.rejects(handlers["identity.totp_remove"](ctx, { password: "nope nope nope" }), (e) => codeOf(e) === "auth.bad_credentials");
  h.db.run(`UPDATE identity_space SET second_factor_required = 1`);
  await assert.rejects(handlers["identity.totp_remove"](ctx, { password: P.secret }), (e) => codeOf(e) === "validation.precondition_failed");
  h.db.run(`UPDATE identity_space SET second_factor_required = 0`);
  await handlers["identity.totp_remove"](ctx, { password: P.secret });
  assert.equal((await handlers["identity.sign_in"](h.anon, { username: "maya", password: P.secret, ...DEVICE })).status, "ok");
  await assert.rejects(handlers["identity.totp_remove"](ctx, { password: P.secret }), (e) => codeOf(e) === "validation.precondition_failed");
});

test("GitHub: link, sign in once the Space is named, refuse a stranger, honour the Space switch and the second factor", async () => {
  const h = await world();
  const gh = { resolve: async (code: string) => { if (code === "good") return { id: "4242", login: "maya-codes" }; if (code === "stranger") return { id: "9", login: "x" }; throw new Error("bad code"); } };
  const ctx = { ...h.as(P.personId), github: gh };
  const anon = { ...h.anon, github: gh };
  assert.equal((await handlers["identity.github_link"](ctx, { code: "good" })).login, "maya-codes");
  await assert.rejects(handlers["identity.github_link"](ctx, { code: "bad" }), (e) => codeOf(e) === "auth.invalid_code");
  const ok = await handlers["identity.github_sign_in"](anon, { code: "good", ...DEVICE });
  assert.equal(ok.status, "ok");
  await assert.rejects(handlers["identity.github_sign_in"](anon, { code: "stranger", ...DEVICE }), (e) => codeOf(e) === "auth.bad_credentials");
  await assert.rejects(handlers["identity.github_sign_in"](anon, { code: "bad", ...DEVICE }), (e) => codeOf(e) === "auth.invalid_code");
  await assert.rejects(handlers["identity.github_sign_in"](h.anon, { code: "good", ...DEVICE }), (e) => codeOf(e) === "internal.unavailable");

  // a second person cannot take the same GitHub account
  await provisionAccount(h.anon, { personId: "usr_omar", username: "omar", name: "Omar", secret: "another long secret" });
  await assert.rejects(handlers["identity.github_link"]({ ...h.as("usr_omar"), github: gh }, { code: "good" }), (e) => codeOf(e) === "validation.duplicate");

  // TOTP still applies after GitHub
  const begin = await handlers["identity.totp_begin"](ctx, {});
  await handlers["identity.totp_confirm"](ctx, { enrolmentId: begin.enrolmentId, code: await totpAt(secretOf(begin.setupUri), stepNow(NOW)) });
  assert.equal((await handlers["identity.github_sign_in"](anon, { code: "good", ...DEVICE })).status, "second_factor_required");

  await handlers["identity.github_unlink"](ctx, {});
  await assert.rejects(handlers["identity.github_sign_in"](anon, { code: "good", ...DEVICE }), (e) => codeOf(e) === "auth.bad_credentials");
  h.db.run(`UPDATE identity_space SET github = 0`);
  await assert.rejects(handlers["identity.github_sign_in"](anon, { code: "good", ...DEVICE }), (e) => codeOf(e) === "validation.unsupported");
});

test("the passkey factor is declared deferred and answers not implemented; SSO is reserved", async () => {
  const h = await world();
  const manifest = readFileSync(new URL("../../../manifests/identity.ts", import.meta.url), "utf8");
  assert.equal((manifest.match(/since: '1\.1\.0'/g) ?? []).length, 2);
  await assert.rejects(handlers["identity.passkey_register"](h.as(P.personId), { attestation: {}, name: "key" }), (e) => codeOf(e) === "internal.not_implemented");
  await assert.rejects(handlers["identity.passkey_remove"](h.as(P.personId), { name: "key" }), (e) => codeOf(e) === "internal.not_implemented");
  await assert.rejects(handlers["identity.sso_sign_in"](h.anon, { provider: "google", code: "c", state: "s", ...DEVICE }), (e) => codeOf(e) === "validation.unsupported");
});

test("pairing: a signed-in device makes a code, another device redeems it once within 10 minutes", async () => {
  const h = await world();
  const made = await handlers["identity.pair_create"](h.as(P.personId), { purpose: "extension" });
  assert.match(made.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(made.expiresAt, NOW + 10 * 60_000);
  const out = await handlers["identity.pair_redeem"](h.anon, { code: made.code.toLowerCase(), deviceName: "Chrome", deviceClass: "extension" });
  assert.equal(out.status, "ok");
  assert.equal(sessionOfToken(h.anon, out.session!.token)?.personId, P.personId);
  assert.ok(h.events.some((e) => e.name === "signin.succeeded" && (e.payload as { method: string }).method === "pair"));
  await assert.rejects(handlers["identity.pair_redeem"](h.anon, { code: made.code, ...DEVICE }), (e) => codeOf(e) === "auth.invalid_code");
  const late = await handlers["identity.pair_create"](h.as(P.personId), { purpose: "daemon" });
  h.advance(11 * 60_000);
  await assert.rejects(handlers["identity.pair_redeem"](h.anon, { code: late.code, ...DEVICE }), (e) => codeOf(e) === "auth.expired");
  await assert.rejects(handlers["identity.pair_create"](h.anon, { purpose: "app" }), (e) => codeOf(e) === "auth.unauthenticated");
});

test("sessions: sign out ends one, expiry ends the rest, whoami reports the caller", async () => {
  const h = await world();
  const a = await handlers["identity.sign_in"](h.anon, { username: "maya", password: P.secret, ...DEVICE });
  const b = await handlers["identity.sign_in"](h.anon, { username: "maya", password: P.secret, deviceName: "Phone", deviceClass: "phone" });
  const ctxA = h.as(P.personId, { id: a.session!.sessionId, deviceId: a.session!.deviceId });
  const who = await handlers["identity.whoami"]({ ...ctxA, directory: { of: () => ({ roles: ["rol_member"], groups: ["grp_everyone"] }) } }, {});
  assert.deepEqual(who.principal, { kind: "person", id: P.personId });
  assert.equal(who.deviceId, a.session!.deviceId);
  assert.deepEqual(who.roles, ["rol_member"]);
  assert.equal(who.spaceId, "spc_test");
  await handlers["identity.sign_out"](ctxA, {});
  assert.equal(sessionOfToken(h.anon, a.session!.token), undefined);
  assert.ok(sessionOfToken(h.anon, b.session!.token));
  h.advance(31 * 24 * 3_600_000);
  assert.equal(sessionOfToken(h.anon, b.session!.token), undefined);
});
