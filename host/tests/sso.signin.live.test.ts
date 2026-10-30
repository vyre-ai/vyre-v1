// Sign in with the firm's own Google app (OpenID Connect), on a booted daemon with a stand-in provider that really signs its ID tokens. An admin turns the provider on with the client secret
// in the Vault; the person goes to the start address, comes back with a ticket, and identity.sso_sign_in opens a session for the person that address belongs to. A forged state, a token from
// another key or another nonce, a token for another app, an address outside the firm's domain, an unverified address, a ticket used twice, an address that belongs to no one, and PKCE that does not
// match all end in no session.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { bootWorld, MEMBER, OWNER } from "../../fixtures/suite/world.ts";
import { createIdp } from "../../fixtures/suite/idp.ts";

const ISSUER = "https://idp.firm.test";
const CLIENT = "firm-app-client";
const SECRET = "client-secret-value-123";
const DOMAIN = "firm.test";
const NOAH = `noah@${DOMAIN}`;
const device = { deviceName: "Test browser", deviceClass: "web" };

test("sign in with the firm's own app: the right person gets a session, and every forgery gets none", async () => {
  const idp = createIdp({ issuer: ISSUER, clientId: CLIENT, secret: SECRET });
  const w = await bootWorld({ prefix: "sso", api: () => undefined, seam: idp.api, members: [], secrets: { "#Sso_Secret": SECRET } });
  try {
    // the admin puts the secret in the Vault and turns the provider on
    const folder = await w.ok(OWNER, "vault.folders.create", { name: "Company connections", scope: "shared", idempotencyKey: w.idem() });
    await w.ok(OWNER, "vault.item.put", { folderId: folder.folder.id, name: "Sso_Secret", kind: "other", fields: [{ key: "key", value: SECRET, secret: true }], idempotencyKey: w.idem() });
    assert.equal((await w.call(MEMBER, "members.sso.set", { provider: { key: "google", title: "Google", issuer: ISSUER, clientId: CLIENT, clientSecretHandle: "#Sso_Secret", enabled: true, domainHint: DOMAIN } })).status, 403, "a member cannot set sign-in up");
    await w.ok(OWNER, "members.sso.set", { provider: { key: "google", title: "Google", issuer: ISSUER, clientId: CLIENT, clientSecretHandle: "#Sso_Secret", enabled: true, domainHint: DOMAIN } });

    const options = await w.ok(OWNER, "identity.sign_in_options", {});
    assert.deepEqual(options.sso, [{ key: "google", title: "Google" }]);
    // Noah's address is the one his invitation went to
    await w.ok(OWNER, "members.invites.list", {});
    const db = new DatabaseSync(`${w.dir}/modules.db`);
    db.prepare("INSERT INTO members_invites (id, code_hash, role, \"groups\", agents, projects, channels, email, expires_at, created_by, state, accepted_by, accepted_at, created_at) VALUES (?, ?, ?, '[]', '[]', '[]', '[]', ?, ?, ?, 'accepted', ?, ?, ?)")
      .run("inv_sso0001", "hash", "rol_member", NOAH, Date.now() + 1e9, "usr_olivia", "usr_noah", Date.now(), Date.now());
    // Noah has an account (the seed gives sessions to tokens, not accounts)
    db.prepare("INSERT OR IGNORE INTO identity_accounts (person_id, username, name, verifier, totp_last_step, fails, locked_until, epoch, created_at) VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?)").run("usr_noah", "noah", "Noah Berg", "x", Date.now());
    db.close();

    const own = w.d.url;
    const start = async (provider = "google") => fetch(`${own}/auth/sso/${provider}/start?return=${encodeURIComponent(`${own}/app`)}`, { redirect: "manual" });
    const callback = (state: string, code: string, cookie: string | null) => fetch(`${own}/auth/sso/google/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
    const begin = async () => {
      const r = await start();
      assert.equal(r.status, 302);
      const to = new URL(r.headers.get("location")!);
      assert.equal(`${to.origin}${to.pathname}`, `${ISSUER}/authorize`);
      assert.equal(to.searchParams.get("code_challenge_method"), "S256");
      assert.equal(to.searchParams.get("hd"), DOMAIN);
      const cookie = r.headers.get("set-cookie")!.split(";")[0]!;
      return { url: to.toString(), state: to.searchParams.get("state")!, cookie };
    };
    const fragment = (r: Response): URLSearchParams => new URLSearchParams(new URL(r.headers.get("location")!).hash.slice(1));
    const claims = { email: NOAH, email_verified: true, hd: DOMAIN };

    // a good sign-in
    const a = await begin();
    const back = await callback(a.state, idp.approve(a.url, claims), a.cookie);
    assert.equal(back.status, 302);
    assert.ok(back.headers.get("location")!.startsWith(`${own}/app#`));
    const ok = fragment(back);
    assert.equal(ok.get("sso_provider"), "google");
    const session = await w.call("", "identity.sso_sign_in", { provider: "google", code: ok.get("sso_code"), state: "-", ...device });
    assert.equal(session.status, 200, session.text);
    assert.equal(session.data.status, "ok");
    assert.ok(session.data.session.token);
    // the ticket is spent
    assert.equal((await w.call("", "identity.sso_sign_in", { provider: "google", code: ok.get("sso_code"), state: "-", ...device })).status, 401);

    // forgeries: each ends with an error in the fragment and no ticket
    const refused = async (what: string, run: () => Promise<Response>) => { const r = await run(); if (r.status === 400) return; const f = fragment(r); assert.equal(f.get("sso_code"), null, what); assert.equal(f.get("sso_error"), "refused", what); };
    const b = await begin();
    await refused("a wrong signing key", () => callback(b.state, idp.approve(b.url, claims, { wrongKey: true }), b.cookie));
    const c = await begin();
    await refused("a tampered token", () => callback(c.state, idp.approve(c.url, claims, { tamper: true }), c.cookie));
    const d2 = await begin();
    await refused("an address outside the firm", () => callback(d2.state, idp.approve(d2.url, { email: "noah@elsewhere.test", email_verified: true }), d2.cookie));
    const e = await begin();
    await refused("an unverified address", () => callback(e.state, idp.approve(e.url, { email: NOAH, email_verified: false, hd: DOMAIN }), e.cookie));
    const f2 = await begin();
    await refused("a hosted domain that is not the firm's", () => callback(f2.state, idp.approve(f2.url, { email: NOAH, email_verified: true, hd: "other.test" }), f2.cookie));
    const g = await begin();
    await refused("a token for another app", () => callback(g.state, idp.approve(g.url, { ...claims, aud: "someone-else" }), g.cookie));
    const h = await begin();
    await refused("a token for another sign-in (wrong nonce)", () => callback(h.state, idp.approve(h.url, { ...claims, nonce: "not-mine" }), h.cookie));
    const i = await begin();
    await refused("an expired token", () => callback(i.state, idp.approve(i.url, { ...claims, exp: Math.floor(Date.now() / 1000) - 3600 }), i.cookie));
    const j = await begin();
    const stolen = idp.approve(j.url, claims);
    await refused("a state without this browser's cookie", () => callback(j.state, stolen, null));
    await refused("a state used a second time", () => callback(j.state, stolen, j.cookie));

    // an address that belongs to no one signs nobody in
    const k = await begin();
    const stranger = fragment(await callback(k.state, idp.approve(k.url, { email: `stranger@${DOMAIN}`, email_verified: true, hd: DOMAIN }), k.cookie));
    assert.equal((await w.call("", "identity.sso_sign_in", { provider: "google", code: stranger.get("sso_code"), state: "-", ...device })).status, 401, "no one has that address");

    // a provider that is not on, a bad return address, a made-up ticket
    assert.equal((await start("microsoft")).status, 503);
    assert.equal((await fetch(`${own}/auth/sso/google/start?return=${encodeURIComponent("https://evil.example/steal")}`, { redirect: "manual" })).status, 400);
    assert.equal((await w.call("", "identity.sso_sign_in", { provider: "google", code: "made-up", state: "-", ...device })).status, 401);
    assert.equal((await w.call("", "identity.sso_sign_in", { provider: "microsoft", code: "x", state: "-", ...device })).status, 422);

    // the secret never went anywhere it should not
    w.d.sink.flush();
    assert.equal(JSON.stringify(w.d.sink.db.prepare("SELECT msg, attrs FROM logs").all()).includes(SECRET), false, "the client secret is in no log");
  } finally { await w.stop(); }
});
