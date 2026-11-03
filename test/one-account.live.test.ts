// One Vyre account everywhere (rc.17), live on two booted Space servers, A and B, through the app's own carry code (apps/app/src/join/identity.ts) and the real client crypto.
//   1. A device with no session joins B through "I already have a Vyre account": it signs in at A, the bundle comes back as ciphertext and opens here, and B gets the same person key; the old
//      recovery code works in B (a real recovery there), and nothing of A's session is left.
//   2. one-account-sso.live.test.ts: a person who signs in to A with Google.
// The account link (Settings > Use one account everywhere) is one-account-link.live.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { openBundle, openSpaceKey, openWithRecovery, wipe } from "../client/src/crypto/keys.ts";
import { carriedOf, signInHome } from "../apps/app/src/join/identity.ts";
import type { HomeDeps } from "../apps/app/src/join/identity.ts";
import { boot, seededDir } from "./memory-live-kit.ts";
import { api, ok, standIn } from "./member-key-kit.ts";
import { FAST, PASSWORD, accept, caller, crypto, deps, invite, joinWithNew, recoverIn, same, sendable, spaceB, spaceOf } from "./one-account-kit.ts";

test("a fresh device joins B with the account it has in A: same person key, the old recovery code works in B, and nothing of A is kept", async () => {
  const dirs = [seededDir()];
  const a = await boot(dirs[0]!, standIn);
  const b = await spaceB("spc_oneid_b", "Beacon");
  try {
    const CODE = "K7QM-4TXD-9WPA-H3NE";
    const dana = await joinWithNew(a, "dana", CODE);
    // the fresh device: options, then sign-in at A, which answers with the bundle and is signed out at once
    let seen: string | null = null;
    const watching: HomeDeps = { ...deps, signedIn: (x, t) => { seen = t; return caller(x, t); } };
    const home = await signInHome(watching, a.url, "dana", PASSWORD);
    assert.ok(home !== "second_factor");
    assert.equal(home.username, "dana");
    assert.equal(home.bundle.publicKey, dana.publicKey);
    await assert.rejects(signInHome(deps, a.url, "dana", "not the password"), (e: { failure?: string }) => e.failure === "signin");
    // B: the same account comes in through the invite
    const carried = carriedOf({ kind: "password", ...home, password: PASSWORD }, crypto);
    const bSpace = await spaceOf(b);
    const made = await carried.carry(bSpace);
    assert.ok(same(made.personKey, dana.personKey), "the same person key, opened on this device");
    wipe(made.personKey);
    const joined = await accept(b, await invite(b), carried.username, carried.password, sendable(made));
    const inB = (await ok(b, joined.token, "identity.keys_get")).keys;
    assert.equal(inB.publicKey, dana.publicKey, "the same key pair");
    const opened = await openBundle(PASSWORD, inB, { argon: FAST });
    assert.ok(same(opened.personKey, dana.personKey));
    assert.equal((await openSpaceKey(opened.privateKey, inB.spaceKeys[0], bSpace)).length, 32, "B's Space key is sealed to the same key pair");
    assert.ok(same((await openWithRecovery(CODE, inB, { argon: FAST })).personKey, dana.personKey), "the old recovery code opens it");
    // and works end to end: a real recovery in B with the old code
    assert.ok(same(await recoverIn(b, "dana", CODE), dana.personKey));
    // the sign-in at A left no session behind
    assert.ok(seen);
    assert.equal((await api(a, seen, "identity.whoami", {})).status, 401, "signed out at A at once");
    assert.equal((await api(a, dana.token, "identity.whoami", {})).status, 200, "her own sessions elsewhere are untouched");
  } finally {
    await a.stop(); await b.stop();
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }
});
