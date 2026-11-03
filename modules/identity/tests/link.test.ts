// rc.17, one account everywhere: identity.link_account. The person proves this Space's account (its password, or a one-use recovery proof); the device sends the bundle it built from both
// accounts. The username, password and key wraps move to the kept account; the person id, the epochs and the data key (formerKey) stay; every old session ends and this device gets a new one.
import test from "node:test";
import assert from "node:assert/strict";
import { x25519Pair, openSeal } from "../../../kernel/src/seal/box.ts";
import { handlers } from "../impl.ts";
import { harness, KEYS, DEVICE, codeOf } from "./wire.ts";
import { SEED_PERSON } from "../fixtures/seed.ts";
import { accountById, bundleOf, provisionAccount, sessionOfToken, setKeys } from "../projections.ts";

const P = SEED_PERSON;
const b64 = (s: string): string => Buffer.from(s).toString("base64");
const KEPT = { personKeyByPassword: b64("kept password wrap"), personKeyByRecovery: b64("kept recovery wrap"), publicKey: b64("kept public key"), privateKeyWrapped: b64("kept private key"), spaceKeys: [{ epoch: 1, wrapped: b64("space key for kept") }], formerKey: b64("this space's data key under the kept key") };
const KEEP = { username: "dana", password: "the kept account password" };

async function world() {
  const h = harness();
  const pair = x25519Pair();
  await provisionAccount(h.anon, P);
  const mine = { ...KEYS, publicKey: Buffer.from(pair.pub, "base64url").toString("base64"), personKeyByRecovery: b64("my recovery wrap") };
  setKeys(h.as(P.personId), P.personId, mine, "first_device");
  const a = await handlers["identity.sign_in"](h.anon, { username: P.username, password: P.secret, ...DEVICE });
  const b = await handlers["identity.sign_in"](h.anon, { username: P.username, password: P.secret, deviceName: "Phone", deviceClass: "phone" });
  const ctx = h.as(P.personId, { id: a.session!.sessionId, deviceId: a.session!.deviceId });
  return { ...h, pair, mine, ctx, tokens: [a.session!.token, b.session!.token] };
}

test("a password proof moves the username, password and wraps, keeps the person, and ends every old session", async () => {
  const h = await world();
  const out = await handlers["identity.link_account"](h.ctx, { currentPassword: P.secret, ...KEEP, keys: KEPT, ...DEVICE });
  assert.equal(out.status, "ok");
  assert.deepEqual(out.keys, KEPT, "the new session hands back the linked bundle, formerKey and all");
  const a = accountById(h.anon, P.personId)!;
  assert.equal(a.username, "dana");
  assert.deepEqual(bundleOf(a), KEPT);
  for (const t of h.tokens) assert.equal(sessionOfToken(h.anon, t), undefined, "old sessions end");
  assert.ok(sessionOfToken(h.anon, out.session!.token), "this device gets a fresh one");
  // the kept password signs in now, the old one does not
  assert.equal((await handlers["identity.sign_in"](h.anon, { username: "dana", password: KEEP.password, ...DEVICE })).status, "ok");
  await assert.rejects(handlers["identity.sign_in"](h.anon, { username: "dana", password: P.secret, ...DEVICE }), (e) => codeOf(e) === "auth.bad_credentials");
  await assert.rejects(handlers["identity.sign_in"](h.anon, { username: P.username, password: P.secret, ...DEVICE }), (e) => codeOf(e) === "auth.bad_credentials");
  const linked = h.events.find((e) => e.name === "account.linked");
  assert.deepEqual(linked?.payload, { personId: P.personId, from: "maya", to: "dana" });
  assert.ok(h.events.some((e) => e.name === "keys.stored" && (e.payload as { reason: string }).reason === "link"));
  assert.ok(!JSON.stringify(h.events).includes(KEEP.password), "no event carries the password");
});

test("a recovery proof works once, in place of the password", async () => {
  const h = await world();
  const fetched = await handlers["identity.recovery_fetch"](h.anon, { username: P.username });
  const proof = openSeal(h.pair.priv, fetched.challenge, fetched.context).toString("base64url");
  const input = { recoveryProof: proof, ...KEEP, keys: KEPT, ...DEVICE };
  assert.equal((await handlers["identity.link_account"](h.ctx, input)).status, "ok");
  // the proof is spent; a guessed one never works
  const again = await handlers["identity.sign_in"](h.anon, { username: "dana", password: KEEP.password, ...DEVICE });
  const ctx2 = h.as(P.personId, { id: again.session!.sessionId, deviceId: again.session!.deviceId });
  await assert.rejects(handlers["identity.link_account"](ctx2, { ...input, keys: { ...KEPT, publicKey: b64("third") } }), (e) => codeOf(e) === "auth.invalid_code");
  await assert.rejects(handlers["identity.link_account"](ctx2, { ...input, recoveryProof: "A".repeat(43), keys: { ...KEPT, publicKey: b64("third") } }), (e) => codeOf(e) === "auth.invalid_code");
});

test("refusals change nothing: no proof, a wrong password, a taken username, a missing formerKey, other epochs, the same key pair", async () => {
  const h = await world();
  await provisionAccount(h.anon, { personId: "usr_other", username: "dana", name: "Someone else", secret: "someone else's password" });
  const go = (patch: Record<string, unknown>) => handlers["identity.link_account"](h.ctx, { currentPassword: P.secret, ...KEEP, keys: KEPT, ...DEVICE, ...patch } as never);
  const { currentPassword: _p, ...noProof } = { currentPassword: P.secret, ...KEEP, keys: KEPT, ...DEVICE };
  await assert.rejects(handlers["identity.link_account"](h.ctx, noProof), (e) => codeOf(e) === "auth.bad_credentials");
  await assert.rejects(go({ currentPassword: "not the password" }), (e) => codeOf(e) === "auth.bad_credentials");
  await assert.rejects(go({}), (e) => codeOf(e) === "validation.duplicate", "the kept username belongs to someone else here");
  await assert.rejects(go({ username: "dana2", keys: { ...KEPT, formerKey: undefined } }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(go({ username: "dana2", keys: { ...KEPT, spaceKeys: [{ epoch: 2, wrapped: b64("x") }] } }), (e) => codeOf(e) === "validation.version_conflict");
  await assert.rejects(go({ username: "dana2", keys: { ...KEPT, publicKey: h.mine.publicKey } }), (e) => codeOf(e) === "validation.precondition_failed");
  await assert.rejects(go({ username: "dana2", password: "short" }), (e) => codeOf(e) === "validation.bad_input");
  const a = accountById(h.anon, P.personId)!;
  assert.equal(a.username, P.username);
  assert.deepEqual(bundleOf(a), h.mine);
  for (const t of h.tokens) assert.ok(sessionOfToken(h.anon, t), "nothing ended");
});

test("keys_put cannot drop or swap a formerKey, and security.get names the username", async () => {
  const h = await world();
  await handlers["identity.link_account"](h.ctx, { currentPassword: P.secret, ...KEEP, keys: KEPT, ...DEVICE });
  const s = await handlers["identity.sign_in"](h.anon, { username: "dana", password: KEEP.password, ...DEVICE });
  const ctx = h.as(P.personId, { id: s.session!.sessionId, deviceId: s.session!.deviceId });
  const { formerKey: _f, ...without } = KEPT;
  await assert.rejects(handlers["identity.keys_put"](ctx, { keys: without, reason: "new_device" }), (e) => codeOf(e) === "permission.no_grant");
  await assert.rejects(handlers["identity.keys_put"](ctx, { keys: { ...KEPT, formerKey: b64("another") }, reason: "new_device" }), (e) => codeOf(e) === "permission.no_grant");
  assert.equal((await handlers["identity.security.get"](ctx, {})).username, "dana");
});
