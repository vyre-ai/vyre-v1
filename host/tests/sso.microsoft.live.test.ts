// Sign in with the firm's own Microsoft app on a booted daemon. Microsoft's email claim is not verified (anyone can set it in a tenant they run), so the Space takes one specific tenant, requires the
// token to come from it, and knows a person by tenant and immutable user id: their first sign-in links the id to the person their account name matches, and from then on the id is who they are. A token
// from another tenant whose email claim is a firm member's address, a foreign tid, and a second user id with a linked person's account name all end in no session.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { bootWorld, OWNER } from "../../fixtures/suite/world.ts";
import { createIdp } from "../../fixtures/suite/idp.ts";

const TENANT = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
const OTHER_TENANT = "1f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
const CLIENT = "firm-ms-app";
const SECRET = "client-secret-value-456";
const DOMAIN = "firm.test";
const NOAH = `noah@${DOMAIN}`;
const NOAH_OID = "aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb";
const device = { deviceName: "Test browser", deviceClass: "web" };

test("Microsoft sign-in: one tenant, linked by user id; another tenant's email claim never signs anyone in", async () => {
  const idp = createIdp({ issuer: ISSUER, clientId: CLIENT, secret: SECRET });
  const w = await bootWorld({ prefix: "ssoms", api: () => undefined, seam: idp.api, members: [], secrets: { "#Sso_Secret": SECRET } });
  try {
    const folder = await w.ok(OWNER, "vault.folders.create", { name: "Company connections", scope: "shared", idempotencyKey: w.idem() });
    await w.ok(OWNER, "vault.item.put", { folderId: folder.folder.id, name: "Sso_Secret", kind: "other", fields: [{ key: "key", value: SECRET, secret: true }], idempotencyKey: w.idem() });
    const set = (issuer: string, enabled = true) => w.call(OWNER, "members.sso.set", { provider: { key: "microsoft", title: "Microsoft", issuer, clientId: CLIENT, clientSecretHandle: "#Sso_Secret", enabled, domainHint: DOMAIN } });
    for (const shared of ["common", "organizations", "consumers", "firm.onmicrosoft.com", "https://login.microsoftonline.com/common/v2.0"]) assert.equal((await set(shared)).status, 422, `${shared} cannot be used for sign-in`);
    const saved = await set(TENANT.toUpperCase());
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.data.provider.issuer, ISSUER, "the tenant id becomes the one fixed issuer");

    await w.ok(OWNER, "members.invites.list", {});
    const db = new DatabaseSync(`${w.dir}/modules.db`);
    db.prepare("INSERT INTO members_invites (id, code_hash, role, \"groups\", agents, projects, channels, email, expires_at, created_by, state, accepted_by, accepted_at, created_at) VALUES (?, ?, ?, '[]', '[]', '[]', '[]', ?, ?, ?, 'accepted', ?, ?, ?)")
      .run("inv_ms000001", "hash", "rol_member", NOAH, Date.now() + 1e9, "usr_olivia", "usr_noah", Date.now(), Date.now());
    db.prepare("INSERT OR IGNORE INTO identity_accounts (person_id, username, name, verifier, totp_last_step, fails, locked_until, epoch, created_at) VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?)").run("usr_noah", "noah", "Noah Berg", "x", Date.now());
    db.close();

    const own = w.d.url;
    const begin = async () => {
      const r = await fetch(`${own}/auth/sso/microsoft/start?return=${encodeURIComponent(`${own}/app`)}`, { redirect: "manual" });
      assert.equal(r.status, 302);
      const to = new URL(r.headers.get("location")!);
      return { url: to.toString(), state: to.searchParams.get("state")!, cookie: r.headers.get("set-cookie")!.split(";")[0]! };
    };
    const signIn = async (claims: Record<string, unknown>): Promise<{ ticket: string | null; error: string | null }> => {
      const a = await begin();
      const code = idp.approve(a.url, claims);
      const back = await fetch(`${own}/auth/sso/microsoft/callback?state=${encodeURIComponent(a.state)}&code=${encodeURIComponent(code)}`, { redirect: "manual", headers: { cookie: a.cookie } });
      const frag = new URLSearchParams(new URL(back.headers.get("location")!).hash.slice(1));
      return { ticket: frag.get("sso_code"), error: frag.get("sso_error") };
    };
    const session = async (ticket: string | null) => w.call("", "identity.sso_sign_in", { provider: "microsoft", code: ticket, state: "-", ...device });
    /** no session at all: the callback refuses the token, or the ticket it left names no one */
    const noSession = async (claims: Record<string, unknown>): Promise<boolean> => {
      const r = await signIn(claims);
      return r.ticket === null || (await session(r.ticket)).status === 401;
    };
    const token = (over: Record<string, unknown> = {}) => ({ tid: TENANT, oid: NOAH_OID, preferred_username: NOAH, email: NOAH, ...over });

    // the first sign-in links the user id to Noah through his account name
    const first = await signIn(token());
    assert.ok(first.ticket, first.error ?? "");
    const s1 = await session(first.ticket);
    assert.equal(s1.status, 200, s1.text);
    assert.ok(s1.data.session.token);

    // the user id is who he is: a changed account name at the firm still lands on Noah
    const renamed = await signIn(token({ preferred_username: `noah.berg@${DOMAIN}`, email: "anything@firm.test" }));
    assert.equal((await session(renamed.ticket)).status, 200, "the linked id signs in whatever the email claim says");

    // nOAuth: a token from another tenant whose email claim is a firm member's address
    const foreign = await signIn(token({ iss: `https://login.microsoftonline.com/${OTHER_TENANT}/v2.0`, tid: OTHER_TENANT, oid: "bbbbbbbb-1111-2222-3333-cccccccccccc" }));
    assert.equal(foreign.ticket, null);
    assert.equal(foreign.error, "refused");
    // the right issuer but a foreign tid
    assert.equal((await signIn(token({ tid: OTHER_TENANT, oid: "bbbbbbbb-1111-2222-3333-cccccccccccc" }))).ticket, null);
    // the same tenant, a different user id, Noah's account name: Noah is already linked to his own id
    assert.equal(await noSession(token({ oid: "cccccccc-1111-2222-3333-dddddddddddd" })), true, "a second id with a linked person's name signs no one in");
    // no user id at all
    assert.equal((await signIn(token({ oid: undefined }))).ticket, null);
    // an email claim at the firm does not stand in for an account name outside it
    assert.equal(await noSession(token({ oid: "dddddddd-1111-2222-3333-eeeeeeeeeeee", preferred_username: "noah@other.test", email: NOAH })), true);
  } finally { await w.stop(); }
});
