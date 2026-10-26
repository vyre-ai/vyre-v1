// identity (lane L7a): sign-in (Space + username + password, TOTP second factor, GitHub, SSO reserved), key wrapping storage,
// pairing, password reset and recovery. Pre-auth calls carry no principal; the gateway treats them as public routes.
// Pre-auth capabilities (sign_in_options, username_available, sign_in, verify_second_factor, github_sign_in, sso_sign_in, pair_redeem,
// recovery_restore, reset_complete, and invites.accept_create_account from ruling 23) declare caller 'anonymous': the gateway accepts them without a principal, applies the rate limit, and never
// exposes them to agents. The join and sign-in screens below declare the same caller kind.
// DECISION: wrapped key bundles are opaque base64 strings; the server stores ciphertext only and never sees the password or personKey.
// DECISION: the passkey factor is declared with since 1.1.0 because spec 3.13 says it ships later; the handler returns internal.not_implemented until then.
import { defineManifest, ev, read, screen, t, write } from '../packages/contracts/src/index.ts';
import { id, ok, principalRef } from './_common.ts';

const V = { level: 'view' } as const;
const deviceClass = t.enm('desktop', 'phone', 'web', 'extension', 'daemon');
const wrapped = t.str({ description: 'Base64 ciphertext; the server cannot open it', examples: ['d3JhcHBlZA=='] });
const keyBundle = t.obj({
  personKeyByPassword: wrapped,                       // personKey wrapped by an Argon2id key from the password
  personKeyByRecovery: t.opt(wrapped),                // wrapped by the recovery code key, if saved
  publicKey: t.str({ examples: ['cHVibGlj'] }),       // x25519 public key
  privateKeyWrapped: wrapped,                         // x25519 private half wrapped by personKey
  spaceKeys: t.arr(t.obj({ epoch: t.int({ minimum: 0 }), wrapped })),
});
const session = t.obj({ sessionId: id.session, deviceId: id.device, token: t.str({ description: 'Session credential, returned once' }), expiresAt: t.ts(), epoch: t.int({ minimum: 0 }) });
const signInOut = {
  status: t.enm('ok', 'second_factor_required'),
  challengeId: t.opt(t.id('chl')),
  session: t.opt(session),
  keys: t.opt(keyBundle),
};
const deviceIn = { deviceName: t.str(), deviceClass };

export default defineManifest({
  id: 'identity',
  title: 'Identity',
  owner: 'L7a',

  events: [
    ev('signin.succeeded', 'A person signed in', { p: { personId: id.user, method: t.enm('password', 'github', 'sso', 'pair', 'recovery'), deviceId: id.device }, subject: ['entity', '/personId'], vis: 'owner', retention: 'audit' }),
    ev('signin.failed', 'A sign-in attempt failed (counted for lockout; no password stored)', { p: { username: t.str(), reason: t.enm('bad_credentials', 'bad_code', 'locked', 'sso_denied') }, subject: ['entity', '/username'], vis: 'private', retention: 'audit' }),
    ev('password.changed', 'A person changed their own password (keys re-wrapped)', { p: { personId: id.user }, subject: ['entity', '/personId'], vis: 'owner', retention: 'audit' }),
    ev('password.reset', 'An admin reset a password and the person set a new one (Mine items lost unless a recovery code was saved)', { p: { personId: id.user, by: t.str(), recovered: t.bool() }, subject: ['entity', '/personId'], retention: 'audit' }),
    ev('factor.enrolled', 'A second factor was added', { p: { personId: id.user, kind: t.enm('totp', 'passkey') }, subject: ['entity', '/personId'], vis: 'owner', retention: 'audit' }),
    ev('factor.removed', 'A second factor was removed', { p: { personId: id.user, kind: t.enm('totp', 'passkey') }, subject: ['entity', '/personId'], vis: 'owner', retention: 'audit' }),
    ev('recovery.saved', 'A recovery code was saved (the code itself is never sent)', { p: { personId: id.user }, subject: ['entity', '/personId'], vis: 'owner', retention: 'audit' }),
    ev('keys.stored', 'A wrapped key bundle was stored or re-wrapped', { p: { personId: id.user, reason: t.enm('first_device', 'password_change', 'reset', 'recovery', 'space_key_epoch', 'new_device') }, subject: ['entity', '/personId'], vis: 'owner' }),
    ev('github.linked', 'A GitHub account was linked to the sign-in', { p: { personId: id.user, login: t.str() }, subject: ['entity', '/personId'], vis: 'owner' }),
    ev('github.unlinked', 'The GitHub link was removed', { p: { personId: id.user }, subject: ['entity', '/personId'], vis: 'owner' }),
  ],

  capabilities: [
    read('identity.sign_in_options', 'What the sign-in page offers for this Space: name, logo, key fingerprint, password, GitHub, SSO providers, second factor floor', {
      ...V, caller: 'anonymous', rate: { n: 30, perSeconds: 60, scope: 'space' }, in: {}, out: { name: t.str(), logoFileId: t.opt(id.file), fingerprint: t.str({ examples: ['ab12 cd34 ef56 7890'] }), password: t.bool(), github: t.bool(), sso: t.arr(t.obj({ key: t.str(), title: t.str() })), secondFactorRequired: t.bool() },
    }),
    read('identity.username_available', 'Check a username is free (join page)', { ...V, caller: 'anonymous', rate: { n: 30, perSeconds: 60, scope: 'space' }, in: { username: t.str({ pattern: '^[a-z0-9_.-]{2,32}$', examples: ['maya'] }) }, out: { available: t.bool() } }),
    write('identity.sign_in', 'Sign in with Space, username and password; asks for the second factor when one is set', {
      ...V, caller: 'anonymous', in: { username: t.str(), password: t.str(), ...deviceIn, totp: t.opt(t.str({ pattern: '^[0-9]{6}$', examples: ['123456'] })) }, out: signInOut,
      emits: ['signin.succeeded', 'signin.failed'], audit: 'sensitive', offline: 'online', rate: { n: 10, perSeconds: 60, scope: 'principal' }, errors: ['auth.bad_credentials', 'auth.second_factor_required', 'auth.invalid_code'],
    }),
    write('identity.verify_second_factor', 'Finish a sign-in with the second factor code', {
      ...V, caller: 'anonymous', in: { challengeId: t.id('chl'), code: t.str({ examples: ['123456'] }), ...deviceIn }, out: signInOut,
      emits: ['signin.succeeded', 'signin.failed'], audit: 'sensitive', offline: 'online', rate: { n: 10, perSeconds: 60, scope: 'principal' }, errors: ['auth.invalid_code', 'auth.expired'],
    }),
    write('identity.github_sign_in', 'Sign in with GitHub once the Space is named', {
      ...V, caller: 'anonymous', in: { code: t.str(), ...deviceIn }, out: signInOut, emits: ['signin.succeeded', 'signin.failed'], audit: 'sensitive', offline: 'online', rate: { n: 10, perSeconds: 60, scope: 'principal' }, errors: ['auth.bad_credentials', 'auth.invalid_code'],
    }),
    write('identity.sso_sign_in', 'Finish an OIDC sign-in (Google, Microsoft, Okta) with the provider code; reserved until SSO config lands in members', {
      ...V, caller: 'anonymous', in: { provider: t.str({ examples: ['google'] }), code: t.str(), state: t.str(), ...deviceIn }, out: signInOut, emits: ['signin.succeeded', 'signin.failed'], audit: 'sensitive', offline: 'online', rate: { n: 10, perSeconds: 60, scope: 'principal' }, errors: ['auth.bad_credentials', 'auth.invalid_code'],
    }),
    write('identity.sign_out', 'End this session; the device keeps nothing it should not', { ...V, in: { sessionId: t.opt(id.session) }, out: ok, offline: 'online', tool: 'meta' }),
    read('identity.whoami', 'Who the caller is here: person, roles, clearance, device, epoch', {
      ...V, out: { principal: principalRef, name: t.str(), roles: t.arr(id.role), groups: t.arr(id.group), deviceId: t.opt(id.device), epoch: t.int({ minimum: 0 }), spaceId: id.space, deferred: t.opt(t.arr(t.str())) }, tool: 'meta',
    }),

    // ---- pairing (one stack for the app, the extension and the daemon)
    write('identity.pair_create', 'A signed-in device makes a short pair code for another device, the extension or the local daemon (valid 10 minutes)', {
      ...V, idem: 'key', in: { purpose: t.enm('app', 'extension', 'daemon') }, out: { code: t.str({ examples: ['K7P2-9QXA'] }), expiresAt: t.ts() }, offline: 'online', audit: 'sensitive',
    }),
    write('identity.pair_redeem', 'Trade a pair code or invite code for a session on a new device', {
      ...V, caller: 'anonymous', in: { code: t.str(), ...deviceIn }, out: signInOut, emits: ['signin.succeeded', 'signin.failed'], audit: 'sensitive', offline: 'online', rate: { n: 5, perSeconds: 60, scope: 'principal' }, errors: ['auth.invalid_code', 'auth.expired'],
    }),

    // ---- key wrapping storage
    read('identity.keys_get', 'Fetch the wrapped key bundle for the signed-in person (ciphertext only)', { ...V, out: { keys: keyBundle } }),
    write('identity.keys_put', 'Store or replace the wrapped key bundle (first device, password change, recovery, new Space key epoch)', {
      ...V, in: { keys: keyBundle, reason: t.enm('first_device', 'password_change', 'reset', 'recovery', 'space_key_epoch', 'new_device') }, out: ok, emits: ['keys.stored'], audit: 'sensitive', offline: 'online',
    }),

    // ---- password, recovery, reset
    write('identity.change_password', 'Change my own password; keys are re-wrapped on the device first', {
      ...V, in: { currentPassword: t.str(), newPassword: t.str(), keys: keyBundle }, out: ok, emits: ['password.changed', 'keys.stored'], audit: 'sensitive', offline: 'online', errors: ['auth.bad_credentials'],
    }),
    write('identity.recovery_save', 'Save a recovery code so a reset keeps Mine vault items, private chats and personal memory', {
      ...V, in: { personKeyByRecovery: wrapped }, out: ok, emits: ['recovery.saved', 'keys.stored'], audit: 'sensitive', offline: 'online',
    }),
    write('identity.recovery_restore', 'Set a new password with a recovery code (keys unwrapped by the code, re-wrapped by the password)', {
      ...V, caller: 'anonymous', in: { username: t.str(), recoveryProof: t.str(), newPassword: t.str(), keys: keyBundle, ...deviceIn }, out: signInOut,
      emits: ['password.reset', 'keys.stored', 'signin.succeeded', 'signin.failed'], audit: 'always', offline: 'online', rate: { n: 5, perSeconds: 300, scope: 'principal' }, errors: ['auth.invalid_code'],
    }),
    // Ruling 23: the pre-auth half of joining by invite. The person does not exist yet, so the caller is anonymous (no principal), rate limited
    // per Space and audited. It lives in this manifest because the invites module list is frozen; members.accept stays for a caller already holding a pending join session.
    write('invites.accept_create_account', 'Join by invite with no account yet: creates the person, sets the password, stores the wrapped keys and joins the Space with the invite\'s role and groups', {
      ...V, caller: 'anonymous', in: { code: t.str(), username: t.str({ pattern: '^[a-z0-9_.-]{2,32}$', examples: ['maya'] }), displayName: t.opt(t.str()), password: t.str(), ...deviceIn, keys: keyBundle }, out: signInOut,
      emits: ['member.joined', 'principal.created', 'keys.stored', 'signin.succeeded'], audit: 'always', offline: 'online', rate: { n: 10, perSeconds: 60, scope: 'principal' }, errors: ['auth.invalid_code', 'auth.expired', 'validation.duplicate'],
    }),
    // Ruling 71: the first owner of a fresh Space. The host makes the Space and the owner's principal at first start and prints a one-time claim link; the owner's client builds the key
    // bundle from the password they pick (the server never sees the personKey) and calls this once. The code is stored hashed, works once and lasts 24 hours.
    write('identity.claim_owner', 'Claim a fresh Space as its owner with the one-time link: pick a username and password, store the wrapped keys, and sign in', {
      ...V, caller: 'anonymous', in: { code: t.str(), spaceId: t.str({ description: 'The Space id from the claim link (#s=); the first Space key is sealed to it and a different Space is refused', examples: ['spc_a1b2c3'] }), username: t.str({ pattern: '^[a-z0-9_.-]{2,32}$', examples: ['olivia'] }), displayName: t.opt(t.str()), password: t.str(), ...deviceIn, keys: keyBundle }, out: signInOut,
      emits: ['keys.stored', 'signin.succeeded'], audit: 'always', offline: 'online', rate: { n: 5, perSeconds: 300, scope: 'principal' }, errors: ['auth.invalid_code', 'auth.expired', 'validation.duplicate'],
    }),
    read('identity.reset_preview', 'Admin: what a password reset would lose for this person (Mine items, private chats, personal memory) and whether a recovery code exists', {
      ...V, in: { personId: id.user }, out: { hasRecoveryCode: t.bool(), losses: t.arr(t.obj({ kind: t.enm('vault_mine', 'private_chats', 'personal_memory'), count: t.int({ minimum: 0 }) })) }, perm: 'access.manage', tool: 'engineer', team: true,
    }),
    write('identity.reset_start', 'Admin: start a password reset and get a one-time link for the person (valid 24 hours); their other devices are signed out', {
      ...V, idem: 'key', in: { personId: id.user }, out: { resetCode: t.str(), expiresAt: t.ts() }, perm: 'access.manage', audit: 'always', risk: 'high', tool: 'engineer', team: true,
    }),
    write('identity.reset_complete', 'The person sets a new password from the reset link and makes fresh keys', {
      ...V, caller: 'anonymous', rate: { n: 30, perSeconds: 60, scope: 'principal' }, in: { resetCode: t.str(), newPassword: t.str(), keys: keyBundle, ...deviceIn }, out: signInOut, emits: ['password.reset', 'keys.stored', 'signin.succeeded'], audit: 'always', offline: 'online', errors: ['auth.invalid_code', 'auth.expired'], team: true,
    }),

    // ---- second factor (the Space floor is in members)
    write('identity.totp_begin', 'Start a TOTP enrolment; returns the shared secret once as a setup URI', {
      ...V, in: {}, out: { setupUri: t.str({ description: 'otpauth URI, shown once', examples: ['otpauth://totp/Vyre:maya?secret=ABC'] }), enrolmentId: t.id('enr') }, offline: 'online', audit: 'sensitive', tool: 'meta',
    }),
    write('identity.totp_confirm', 'Confirm a TOTP enrolment with the first code', { ...V, in: { enrolmentId: t.id('enr'), code: t.str({ examples: ['123456'] }) }, out: ok, emits: ['factor.enrolled'], offline: 'online', audit: 'sensitive', errors: ['auth.invalid_code'], tool: 'meta' }),
    write('identity.totp_remove', 'Remove my TOTP factor (refused when the Space requires a second factor)', { ...V, in: { password: t.str() }, out: ok, emits: ['factor.removed'], offline: 'online', audit: 'sensitive', errors: ['auth.bad_credentials', 'validation.precondition_failed'], tool: 'meta' }),
    write('identity.passkey_register', 'Add a passkey as a second factor (ships later)', { ...V, in: { attestation: t.json(), name: t.str() }, out: ok, emits: ['factor.enrolled'], offline: 'online', audit: 'sensitive', since: '1.1.0', tool: 'meta' }),
    write('identity.passkey_remove', 'Remove a passkey (ships later)', { ...V, in: { name: t.str() }, out: ok, emits: ['factor.removed'], offline: 'online', audit: 'sensitive', since: '1.1.0', tool: 'meta' }),

    // ---- GitHub link
    write('identity.github_link', 'Link a GitHub account so it can sign in once the Space is named', { ...V, in: { code: t.str() }, out: { login: t.str() }, emits: ['github.linked'], offline: 'online', audit: 'sensitive', tool: 'meta' }),
    write('identity.github_unlink', 'Remove the GitHub link', { ...V, in: {}, out: ok, emits: ['github.unlinked'], offline: 'online', audit: 'sensitive', tool: 'meta' }),
  ],
  screens: [
    screen('join.sign-in', 'join', 'ui:JoinSignIn', {
      caller: 'anonymous', q: { options: ['identity.sign_in_options', {}, false] },
      a: {
        signIn: ['identity.sign_in', { username: '/state/username', password: '/state/password', totp: '/state/totp' }],
        second: ['identity.verify_second_factor', { challengeId: '/state/challengeId', code: '/state/code' }],
        github: ['identity.github_sign_in', { code: '/state/code' }],
        sso: ['identity.sso_sign_in', { provider: '/state/provider', code: '/state/code', state: '/state/state' }],
        pair: ['identity.pair_redeem', { code: '/state/code' }],
      },
      empty: 'Enter the Space address', primary: 'Continue',
    }),
    screen('join.reset', 'join', 'ui:JoinReset', {
      caller: 'anonymous',
      a: { recover: ['identity.recovery_restore', { username: '/state/username', recoveryProof: '/state/proof', newPassword: '/state/password' }], complete: ['identity.reset_complete', { resetCode: '/state/code', newPassword: '/state/password' }] },
      empty: 'Enter your recovery code', primary: 'Set password',
    }),
  ],
});
