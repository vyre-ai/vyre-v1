// Wrapped key storage: keys never leave the device unwrapped; password change, recovery and reset re-wrap; sessions expire.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { codeOf, DEVICE, harness, KEYS } from "./wire.ts";
import { SEED_PERSON } from "../fixtures/seed.ts";
import { provisionAccount, sessionOfToken, sha } from "../projections.ts";

const P = SEED_PERSON;
const NEW_PASSWORD = "a brand new password";

async function world() {
  const h = harness();
  await provisionAccount(h.anon, P);
  return h;
}
async function signedIn(h: Awaited<ReturnType<typeof world>>, device: { deviceName: string; deviceClass: "desktop" | "phone" } = DEVICE) {
  const out = await handlers["identity.sign_in"](h.anon, { username: P.username, password: P.secret, ...device });
  return { out, ctx: h.as(P.personId, { id: out.session!.sessionId, deviceId: out.session!.deviceId }) };
}

test("keys round-trip as ciphertext only, and sign-in returns them", async () => {
  const h = await world();
  const { ctx } = await signedIn(h);
  await assert.rejects(handlers["identity.keys_get"](ctx, {}), (e) => codeOf(e) === "validation.not_found");
  await handlers["identity.keys_put"](ctx, { keys: KEYS, reason: "first_device" });
  assert.deepEqual((await handlers["identity.keys_get"](ctx, {})).keys, KEYS);
  const again = await handlers["identity.sign_in"](h.anon, { username: P.username, password: P.secret, ...DEVICE });
  assert.deepEqual(again.keys, KEYS);
  // what is stored is exactly what the device wrapped, and the password is nowhere in it
  const stored = (h.db.all(`SELECT keys_json, verifier FROM identity_accounts`) as { keys_json: string; verifier: string }[])[0]!;
  assert.deepEqual(JSON.parse(stored.keys_json), KEYS);
  assert.ok(!stored.keys_json.includes(P.secret));
  assert.ok(!JSON.stringify(h.events).includes(KEYS.personKeyByPassword), "events never carry key material");
  assert.ok(h.events.some((e) => e.name === "keys.stored"));
});

test("a bundle that is not base64 ciphertext is refused, and first_device only works once", async () => {
  const h = await world();
  const { ctx } = await signedIn(h);
  await assert.rejects(handlers["identity.keys_put"](ctx, { keys: { ...KEYS, personKeyByPassword: "my plain key!" }, reason: "first_device" }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(handlers["identity.keys_put"](ctx, { keys: KEYS, reason: "new_device" }), (e) => codeOf(e) === "validation.precondition_failed");
  await handlers["identity.keys_put"](ctx, { keys: KEYS, reason: "first_device" });
  await assert.rejects(handlers["identity.keys_put"](ctx, { keys: KEYS, reason: "first_device" }), (e) => codeOf(e) === "validation.precondition_failed");
  await handlers["identity.keys_put"](ctx, { keys: { ...KEYS, spaceKeys: [...KEYS.spaceKeys, { epoch: 2, wrapped: "c3BhY2Uta2V5LTI=" }] }, reason: "space_key_epoch" });
  assert.equal((await handlers["identity.whoami"](ctx, {})).epoch, 2);
  await assert.rejects(handlers["identity.keys_put"](ctx, { keys: KEYS, reason: "space_key_epoch" }), (e) => codeOf(e) === "validation.version_conflict");
});

test("keys are only ever returned to their owner", async () => {
  const h = await world();
  const { ctx } = await signedIn(h);
  await handlers["identity.keys_put"](ctx, { keys: KEYS, reason: "first_device" });
  await provisionAccount(h.anon, { personId: "usr_omar", username: "omar", name: "Omar", secret: "another long secret" });
  await assert.rejects(handlers["identity.keys_get"](h.as("usr_omar"), {}), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(handlers["identity.keys_get"](h.anon, {}), (e) => codeOf(e) === "auth.unauthenticated");
  await assert.rejects(handlers["identity.keys_put"](h.anon, { keys: KEYS, reason: "first_device" }), (e) => codeOf(e) === "auth.unauthenticated");
  const agent = { ...h.as(P.personId), principal: { kind: "agent", id: "agt_x" } };
  await assert.rejects(handlers["identity.keys_get"](agent, {}), (e) => codeOf(e) === "auth.unauthenticated");
});

test("sessions expire after 30 days", async () => {
  const h = await world();
  const { out } = await signedIn(h);
  assert.ok(sessionOfToken(h.anon, out.session!.token));
  h.advance(30 * 24 * 3_600_000 - 1);
  assert.ok(sessionOfToken(h.anon, out.session!.token));
  h.advance(2);
  assert.equal(sessionOfToken(h.anon, out.session!.token), undefined);
});

test("change password re-wraps keys, signs out the other devices, and keeps this one", async () => {
  const h = await world();
  const first = await signedIn(h);
  const phone = await signedIn(h, { deviceName: "Phone", deviceClass: "phone" });
  await handlers["identity.keys_put"](first.ctx, { keys: KEYS, reason: "first_device" });
  const rewrapped = { ...KEYS, personKeyByPassword: "cmV3cmFwcGVkLWJ5LW5ldy1wYXNzd29yZA==" };
  await assert.rejects(handlers["identity.change_password"](first.ctx, { currentPassword: "wrong wrong wrong", newPassword: NEW_PASSWORD, keys: rewrapped }), (e) => codeOf(e) === "auth.bad_credentials");
  await assert.rejects(handlers["identity.change_password"](first.ctx, { currentPassword: P.secret, newPassword: "short", keys: rewrapped }), (e) => codeOf(e) === "validation.bad_input");
  await handlers["identity.change_password"](first.ctx, { currentPassword: P.secret, newPassword: NEW_PASSWORD, keys: rewrapped });
  assert.deepEqual((await handlers["identity.keys_get"](first.ctx, {})).keys, rewrapped);
  assert.ok(sessionOfToken(h.anon, first.out.session!.token));
  assert.equal(sessionOfToken(h.anon, phone.out.session!.token), undefined);
  await assert.rejects(handlers["identity.sign_in"](h.anon, { username: P.username, password: P.secret, ...DEVICE }), (e) => codeOf(e) === "auth.bad_credentials");
  assert.equal((await handlers["identity.sign_in"](h.anon, { username: P.username, password: NEW_PASSWORD, ...DEVICE })).status, "ok");
  assert.ok(h.events.some((e) => e.name === "password.changed"));
});

test("a saved recovery code restores access without a session", async () => {
  const h = await world();
  const { ctx, out } = await signedIn(h);
  await assert.rejects(handlers["identity.recovery_save"](ctx, { personKeyByRecovery: "cmVjb3Zlcnk=" }), (e) => codeOf(e) === "validation.precondition_failed");
  await handlers["identity.keys_put"](ctx, { keys: KEYS, reason: "first_device" });
  const wrap = "cmVjb3ZlcnktY2lwaGVydGV4dA==";
  await handlers["identity.recovery_save"](ctx, { personKeyByRecovery: wrap });
  assert.ok(h.events.some((e) => e.name === "recovery.saved"));
  assert.equal((await handlers["identity.reset_preview"](ctx, { personId: P.personId })).hasRecoveryCode, true);

  const fresh = { ...KEYS, personKeyByPassword: "cmUtd3JhcHBlZC1ieS1uZXc=", personKeyByRecovery: wrap };
  await assert.rejects(handlers["identity.recovery_restore"](h.anon, { username: P.username, recoveryProof: "wrong", newPassword: NEW_PASSWORD, keys: fresh, ...DEVICE }), (e) => codeOf(e) === "auth.invalid_code");
  await assert.rejects(handlers["identity.recovery_restore"](h.anon, { username: "nobody", recoveryProof: sha(wrap), newPassword: NEW_PASSWORD, keys: fresh, ...DEVICE }), (e) => codeOf(e) === "auth.invalid_code");
  const back = await handlers["identity.recovery_restore"](h.anon, { username: P.username, recoveryProof: sha(wrap), newPassword: NEW_PASSWORD, keys: fresh, ...DEVICE });
  assert.equal(back.status, "ok");
  assert.deepEqual(back.keys, fresh);
  assert.equal(sessionOfToken(h.anon, out.session!.token), undefined);
  assert.equal((await handlers["identity.sign_in"](h.anon, { username: P.username, password: NEW_PASSWORD, ...DEVICE })).status, "ok");
  assert.ok(h.events.some((e) => e.name === "password.reset" && (e.payload as { recovered: boolean }).recovered === true));
});

test("admin reset: preview, one-time link for 24 hours, fresh keys, other devices signed out", async () => {
  const h = await world();
  const { ctx, out } = await signedIn(h);
  await handlers["identity.keys_put"](ctx, { keys: KEYS, reason: "first_device" });
  const withLosses = { ...ctx, losses: { of: () => ({ vault_mine: 3, private_chats: 0, personal_memory: 2 }) } };
  const preview = await handlers["identity.reset_preview"](withLosses, { personId: P.personId });
  assert.equal(preview.hasRecoveryCode, false);
  assert.deepEqual(preview.losses, [{ kind: "vault_mine", count: 3 }, { kind: "personal_memory", count: 2 }]);
  await assert.rejects(handlers["identity.reset_preview"](ctx, { personId: "usr_missing" }), (e) => codeOf(e) === "validation.not_found");

  const start = await handlers["identity.reset_start"](h.as("usr_admin"), { personId: P.personId });
  assert.equal(sessionOfToken(h.anon, out.session!.token), undefined);
  const stored = JSON.stringify(h.db.all(`SELECT * FROM identity_codes`));
  assert.ok(!stored.includes(start.resetCode), "the reset code is stored hashed");

  const fresh = { ...KEYS, personKeyByPassword: "ZnJlc2gtcGVyc29uLWtleQ==" };
  await assert.rejects(handlers["identity.reset_complete"](h.anon, { resetCode: "rst_nope", newPassword: NEW_PASSWORD, keys: fresh, ...DEVICE }), (e) => codeOf(e) === "auth.invalid_code");
  const done = await handlers["identity.reset_complete"](h.anon, { resetCode: start.resetCode, newPassword: NEW_PASSWORD, keys: fresh, ...DEVICE });
  assert.equal(done.status, "ok");
  assert.deepEqual(done.keys, fresh);
  await assert.rejects(handlers["identity.reset_complete"](h.anon, { resetCode: start.resetCode, newPassword: NEW_PASSWORD, keys: fresh, ...DEVICE }), (e) => codeOf(e) === "auth.invalid_code");
  assert.equal((await handlers["identity.reset_preview"](ctx, { personId: P.personId })).hasRecoveryCode, false);
  assert.ok(h.events.some((e) => e.name === "password.reset" && (e.payload as { recovered: boolean }).recovered === false));

  const late = await handlers["identity.reset_start"](h.as("usr_admin"), { personId: P.personId });
  h.advance(25 * 3_600_000);
  await assert.rejects(handlers["identity.reset_complete"](h.anon, { resetCode: late.resetCode, newPassword: NEW_PASSWORD, keys: fresh, ...DEVICE }), (e) => codeOf(e) === "auth.expired");
});

test("invites.accept_create_account (ruling 23): creates the person, stores keys, joins, opens a session; refusals leave nothing behind", async () => {
  const h = harness();
  const accepted: { inviteId: string; personId: string }[] = [];
  const invites = {
    peek: (code: string) => (code === "good" ? { inviteId: "inv_1", role: "member", groups: ["grp_a"], invitedBy: "usr_admin" } : code === "old" ? ("expired" as const) : ("invalid" as const)),
    accept: (inviteId: string, personId: string) => { accepted.push({ inviteId, personId }); },
  };
  const ctx = { ...h.anon, invites };
  const input = { code: "good", username: "Omar", displayName: "Omar K", password: "a long enough password", keys: KEYS, ...DEVICE };

  await assert.rejects(handlers["invites.accept_create_account"](h.anon, input), (e) => codeOf(e) === "internal.not_implemented");
  await assert.rejects(handlers["invites.accept_create_account"](ctx, { ...input, code: "nope" }), (e) => codeOf(e) === "auth.invalid_code");
  await assert.rejects(handlers["invites.accept_create_account"](ctx, { ...input, code: "old" }), (e) => codeOf(e) === "auth.expired");
  await assert.rejects(handlers["invites.accept_create_account"](ctx, { ...input, username: "x" }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(handlers["invites.accept_create_account"](ctx, { ...input, password: "short" }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(handlers["invites.accept_create_account"](ctx, { ...input, keys: { ...KEYS, publicKey: "not base64!" } }), (e) => codeOf(e) === "validation.bad_input");
  assert.equal(h.db.all(`SELECT * FROM identity_accounts`).length, 0, "refusals create no account");
  assert.equal(accepted.length, 0, "refusals do not spend the invite");

  const out = await handlers["invites.accept_create_account"](ctx, input);
  assert.equal(out.status, "ok");
  assert.deepEqual(out.keys, KEYS);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0]!.inviteId, "inv_1");
  const who = sessionOfToken(h.anon, out.session!.token);
  assert.equal(who?.personId, accepted[0]!.personId);
  const names = h.events.map((e) => e.name);
  for (const n of ["principal.created", "member.joined", "keys.stored", "signin.succeeded"]) assert.ok(names.includes(n), n);
  assert.ok(!JSON.stringify(h.events).includes("a long enough password"));
  await assert.rejects(handlers["invites.accept_create_account"](ctx, { ...input, displayName: "Again" }), (e) => codeOf(e) === "validation.duplicate");
  assert.equal((await handlers["identity.sign_in"](h.anon, { username: "omar", password: input.password, ...DEVICE })).status, "ok");
});

test("a recovery code is burned after five wrong tries, whoever made them: the right proof then fails too", async () => {
  const h = await world();
  const { ctx } = await signedIn(h);
  await handlers["identity.keys_put"](ctx, { keys: KEYS, reason: "first_device" });
  const wrap = "cmVjb3ZlcnktY2lwaGVydGV4dA==";
  await handlers["identity.recovery_save"](ctx, { personKeyByRecovery: wrap });
  const fresh = { ...KEYS, personKeyByPassword: "cmUtd3JhcHBlZC1ieS1uZXc=", personKeyByRecovery: wrap };
  for (let i = 0; i < 5; i++) {
    await assert.rejects(handlers["identity.recovery_restore"](h.anon, { username: P.username, recoveryProof: `wrong-${i}`, newPassword: NEW_PASSWORD, keys: fresh, ...DEVICE }), (e) => codeOf(e) === "auth.invalid_code");
  }
  assert.equal((await handlers["identity.reset_preview"](ctx, { personId: P.personId })).hasRecoveryCode, false, "the code is gone");
  await assert.rejects(handlers["identity.recovery_restore"](h.anon, { username: P.username, recoveryProof: sha(wrap), newPassword: NEW_PASSWORD, keys: fresh, ...DEVICE }), (e) => codeOf(e) === "auth.invalid_code", "the right proof no longer works");
});
