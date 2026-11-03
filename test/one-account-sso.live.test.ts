// One Vyre account everywhere (rc.17), live on two booted Space servers, A and B, through the app's own carry code (apps/app/src/join/identity.ts) and the real client crypto.
//   1. one-account.live.test.ts: a device with no session, through a password sign-in at A.
//   2. A person who signs in to A with Google (this device stored no username) joins B: the username comes from A, the recovery code opens the bundle, a password chosen now wraps it for B.
//      A second one, on a device with no session at all, brings their account from A with only the username and recovery code.
// The account link (Settings > Use one account everywhere) is one-account-link.live.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { openBundle, openWithRecovery, wipe } from "../client/src/crypto/keys.ts";
import { createIdp } from "../fixtures/suite/idp.ts";
import { bundleAt, carriedOf, checkCode, knownIdentity, recoveryAtHome, recoveryPart, usernameAt } from "../apps/app/src/join/identity.ts";
import { boot, seededDir } from "./memory-live-kit.ts";
import { api, ok, standIn } from "./member-key-kit.ts";
import { FAST, accept, caller, crypto, deps, invite, joinWithNew, recoverIn, same, sendable, spaceB, spaceOf } from "./one-account-kit.ts";

test("a person who signs in to A with Google joins B with their recovery code, and another brings their account with no session at all", async () => {
  const ISSUER = "https://accounts.google.com", CLIENT = "firm-app-client", SECRET = "client-secret-value-123", DOMAIN = "firm.test", EMAIL = `rubab@${DOMAIN}`;
  const idp = createIdp({ issuer: ISSUER, clientId: CLIENT, secret: SECRET });
  const reply = (x: { status?: number; json?: unknown; text?: string } | undefined) => {
    const body = x?.text ?? (x?.json === undefined ? "" : JSON.stringify(x.json));
    return { status: x?.status ?? (x === undefined ? 404 : 200), text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer, headers: { get: () => null as string | null } };
  };
  const dirs = [seededDir()];
  const a = await boot(dirs[0]!, standIn, undefined, { seams: { fetch: async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array }) => reply(await idp.api({ method: init?.method ?? "GET", url, headers: init?.headers ?? {}, body: init?.body })) } } as unknown as NonNullable<Parameters<typeof boot>[3]>);
  const b = await spaceB("spc_oneid_b", "Beacon");
  try {
    const folder = await ok(a, a.token, "vault.folders.create", { name: "Company connections", scope: "shared" });
    await ok(a, a.token, "vault.item.put", { folderId: folder.folder.id, name: "Sso_Secret", kind: "other", fields: [{ key: "key", value: SECRET, secret: true }] });
    await ok(a, a.token, "members.sso.set", { provider: { key: "google", title: "Google", issuer: ISSUER, clientId: CLIENT, clientSecretHandle: "#Sso_Secret", enabled: true, domainHint: DOMAIN } });
    const CODE = "R8BN-2KQX-7HMT-W4PD";
    const rubab = await joinWithNew(a, "rubab", CODE, EMAIL);
    await ok(a, rubab.token, "identity.sign_out", {});
    // later, on this device, she signs in to A with Google: the session stored here has no username
    const start = await fetch(`${a.url}/auth/sso/google/start?return=${encodeURIComponent(`${a.url}/app`)}`, { redirect: "manual" });
    const to = new URL(start.headers.get("location")!);
    const cookie = start.headers.get("set-cookie")!.split(";")[0]!;
    const back = await fetch(`${a.url}/auth/sso/google/callback?state=${encodeURIComponent(to.searchParams.get("state")!)}&code=${encodeURIComponent(idp.approve(to.toString(), { sub: "rubab-google-id", email: EMAIL, email_verified: true, hd: DOMAIN }))}`, { redirect: "manual", headers: { cookie } });
    const fragment = new URLSearchParams(new URL(back.headers.get("location")!).hash.slice(1));
    const signed = await api(a, null, "identity.sso_sign_in", { provider: "google", code: fragment.get("sso_code"), state: "-", deviceName: "Chrome", deviceClass: "web" });
    assert.equal(signed.status, 200, JSON.stringify(signed.data));
    const token = signed.data.session.token as string;
    const aSpace = await spaceOf(a);
    const known = knownIdentity([{ baseUrl: a.url, token, personId: rubab.personId, marker: "m", displayName: "Rubab", def: { spaceId: aSpace, name: "Firm", kind: "team" } } as never]);
    assert.equal(known?.provider, true);
    assert.equal(known?.username, undefined, "Google sign-in stored no username");
    // Continue as: the username comes from A, the recovery code opens her bundle here (a wrong one is said before a password is chosen)
    const source = caller(a.url, token);
    assert.equal(await usernameAt(source), "rubab");
    const part = recoveryPart(await bundleAt(source));
    const openCode = async (c: string, bundle: NonNullable<typeof part>) => { wipe((await openWithRecovery(c, { personKeyByPassword: "", ...bundle }, { argon: FAST })).personKey); };
    await assert.rejects(checkCode(openCode, part, "WRNG-2KQX-7HMT-W4PD"), (e: { failure?: string }) => e.failure === "code");
    await checkCode(openCode, part, CODE);
    const NEW = "a password chosen once";
    const carried = carriedOf({ kind: "code", username: "rubab", name: "Rubab", code: CODE, newPassword: NEW, bundle: part! }, crypto);
    const bSpace = await spaceOf(b);
    const made = await carried.carry(bSpace);
    assert.ok(same(made.personKey, rubab.personKey));
    const joined = await accept(b, await invite(b), carried.username, carried.password, sendable(made));
    const inB = (await ok(b, joined.token, "identity.keys_get")).keys;
    assert.equal(inB.publicKey, rubab.publicKey);
    assert.ok(same((await openBundle(NEW, inB, { argon: FAST })).personKey, rubab.personKey), "the password she chose opens it in B");
    assert.equal((await api(b, null, "identity.sign_in", { username: "rubab", password: NEW, deviceName: "PC", deviceClass: "desktop" })).status, 200, "and signs her in to B");
    assert.ok(same(await recoverIn(b, "rubab", CODE), rubab.personKey), "the same recovery code works in B");
    // no key ever left A: the only thing A answered was ciphertext
    assert.equal((await api(a, token, "identity.keys_get", {})).data.keys.personKeyByRecovery, part!.personKeyByRecovery);

    // Noah: Google at A too, but this device has no session at all. Username and recovery code, against A, with nothing signed in
    const NOAH_CODE = "N3VX-8QPL-2MRT-6KWD";
    const noah = await joinWithNew(a, "noah", NOAH_CODE, `noah@${DOMAIN}`);
    const fetched = await recoveryAtHome(deps, a.url, "noah");
    const unknown = await recoveryAtHome(deps, a.url, "nobody-here");
    await assert.rejects(checkCode(openCode, unknown, NOAH_CODE), (e: { failure?: string }) => e.failure === "code", "an unknown name reads like a wrong code");
    await checkCode(openCode, fetched, NOAH_CODE);
    const noahMade = await carriedOf({ kind: "code", username: "noah", name: "noah", code: NOAH_CODE, newPassword: NEW, bundle: fetched }, crypto).carry(bSpace);
    assert.ok(same(noahMade.personKey, noah.personKey));
    await accept(b, await invite(b), "noah", NEW, sendable(noahMade));
    assert.ok(same(await recoverIn(b, "noah", NOAH_CODE), noah.personKey));
  } finally {
    await a.stop(); await b.stop();
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }
});
