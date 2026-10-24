// members (lane L7a): invites, the join page accept, suspend and the removal wizard with transfer preview, SSO (OIDC) and second-factor config.
// NOT EXPRESSIBLE: members.invites.preview and members.accept run before sign-in (no principal) and must stay off the agent surface, so the join accept screen is not declared.
// DECISION: members.accept creates the person and session, then stores the wrapped keys by calling identity.keys_put; it emits member.joined and principal.created itself.
// DECISION: sign-in policy (second-factor floor, SSO required, allowed methods) is written as policies of kind sign_in through members.sign_in_policy.set, which emits policy.changed; the settings rows below mirror the values for Cmd-F search.
import { defineManifest, ev, read, screen, setting, t, write } from '../packages/contracts/src/index.ts';
import { id, email, ok, pageIn, pageOut, principalRef, url } from './_common.ts';

const V = { level: 'view' } as const;
const deviceClass = t.enm('desktop', 'phone', 'web', 'extension', 'daemon');
const wrapped = t.str({ description: 'Base64 ciphertext; the server cannot open it', examples: ['d3JhcHBlZA=='] });
const keyBundle = t.obj({
  personKeyByPassword: wrapped, personKeyByRecovery: t.opt(wrapped), publicKey: t.str({ examples: ['cHVibGlj'] }), privateKeyWrapped: wrapped,
  spaceKeys: t.arr(t.obj({ epoch: t.int({ minimum: 0 }), wrapped })),
});
const inviteRow = t.obj({
  id: id.invite, role: id.role, groups: t.arr(id.group), agents: t.arr(id.agent), projects: t.arr(id.project), channels: t.arr(id.channel),
  email: t.opt(email), expiresAt: t.ts(), createdBy: id.user, state: t.enm('open', 'accepted', 'revoked', 'expired'),
  aiKeyHandle: t.opt(id.handle), acceptedBy: t.opt(id.user), createdAt: t.ts(),
});
const removalKind = t.enm('routines', 'automations', 'agents', 'records', 'files', 'channels', 'projects', 'mailbox_connections', 'vault_mine', 'private_chats', 'memory_from_you');
const removalAction = t.enm('pause', 'reassign', 'revoke', 'export', 'retain', 'keep', 'delete');
const ssoRow = t.obj({ key: t.enm('google', 'microsoft', 'okta'), title: t.str(), issuer: url, clientId: t.str(), clientSecretHandle: id.handle, enabled: t.bool(), domainHint: t.opt(t.str()) });
const policy = t.obj({ secondFactor: t.enm('off', 'required'), requireSso: t.bool(), allowPassword: t.bool(), allowGithub: t.bool() });

export default defineManifest({
  id: 'members',
  title: 'Members',
  owner: 'L7a',

  events: [
    ev('member.invited', 'An invite was made', { p: { inviteId: id.invite, role: id.role, expiresAt: t.ts() }, subject: ['entity', '/inviteId'], retention: 'audit' }),
    ev('member.invite_revoked', 'An invite was revoked', { p: { inviteId: id.invite }, subject: ['entity', '/inviteId'], retention: 'audit' }),
    ev('member.joined', 'A person accepted an invite and is active; the inviter gets a quiet line', { p: { personId: id.user, inviteId: id.invite, role: id.role, invitedBy: id.user }, subject: ['entity', '/personId'], notify: 'member.joined', trigger: { title: 'A person joins', fields: ['/role'] }, retention: 'audit' }),
    ev('member.removed', 'A person was removed or left; devices purge, the Space key epoch rotates', { p: { personId: id.user, by: t.str(), reason: t.opt(t.str()) }, subject: ['entity', '/personId'], trigger: { title: 'A person is removed' }, retention: 'audit' }),
    ev('member.removal_plan_applied', 'The removal wizard reassigned or paused the things the person owned (counts only)', { p: { personId: id.user, kinds: t.arr(t.obj({ kind: removalKind, action: removalAction, count: t.int({ minimum: 0 }) })) }, subject: ['entity', '/personId'], retention: 'audit' }),
  ],

  capabilities: [
    // ---- invites
    read('members.invites.list', 'List invites', { ...V, in: { state: t.opt(t.enm('open', 'accepted', 'revoked', 'expired')), ...pageIn }, out: { invites: t.arr(inviteRow), ...pageOut }, perm: 'members.invite', tool: 'meta', team: true }),
    write('members.invites.create', 'Invite a person: role, groups, the agents, projects and channels they start in, expiry; returns the link (address, one-time code, Space key fingerprint)', {
      ...V, idem: 'key', in: { role: id.role, email: t.opt(email), groups: t.opt(t.arr(id.group)), agents: t.opt(t.arr(id.agent)), projects: t.opt(t.arr(id.project)), channels: t.opt(t.arr(id.channel)), expiresInDays: t.opt(t.int({ minimum: 1, maximum: 90 })), aiKeyHandle: t.opt(id.handle) },
      out: { invite: inviteRow, link: t.str({ description: 'Shown once; the code is stored only as a hash', examples: ['https://team.example.com/join/K7P2-9QXA'] }) },
      perm: 'members.invite', emits: ['member.invited'], audit: 'always', tool: 'meta', team: true,
    }),
    write('members.invites.extend', 'Give an open invite a new expiry', { ...V, in: { inviteId: id.invite, expiresInDays: t.int({ minimum: 1, maximum: 90 }) }, out: { invite: inviteRow }, perm: 'members.invite', tool: 'meta', team: true }),
    write('members.invites.revoke', 'Revoke an open invite', { ...V, in: { inviteId: id.invite }, out: ok, perm: 'members.invite', emits: ['member.invite_revoked'], audit: 'always', tool: 'meta', team: true }),
    read('members.invites.preview', 'Join page: the Space name and logo, who invited, expiry and key fingerprint for a code', {
      ...V, in: { code: t.str() }, out: { spaceName: t.str(), logoFileId: t.opt(id.file), invitedBy: t.str(), role: t.str(), expiresAt: t.ts(), fingerprint: t.str({ examples: ['ab12 cd34 ef56 7890'] }) }, errors: ['auth.invalid_code', 'auth.expired'],
    }),
    write('members.accept', 'Accept an invite: pick a username and password, the device makes its keys; the person becomes active', {
      ...V, in: { code: t.str(), username: t.str({ pattern: '^[a-z0-9_.-]{2,32}$', examples: ['maya'] }), displayName: t.opt(t.str()), password: t.str(), deviceName: t.str(), deviceClass, keys: keyBundle },
      out: { personId: id.user, sessionId: id.session, token: t.str({ description: 'Session credential, returned once' }), epoch: t.int({ minimum: 0 }) },
      emits: ['member.joined', 'principal.created'], audit: 'always', offline: 'online', rate: { n: 10, perSeconds: 60, scope: 'space' }, errors: ['auth.invalid_code', 'auth.expired', 'validation.duplicate'], team: true,
    }),

    // ---- suspend and remove
    write('members.suspend', 'Suspend a person: they cannot act and their devices purge on next contact', { ...V, in: { personId: id.user, reason: t.opt(t.str()) }, out: ok, perm: 'members.remove', emits: ['principal.suspended'], audit: 'always', tool: 'meta', team: true }),
    write('members.reactivate', 'Reactivate a suspended person', { ...V, in: { personId: id.user }, out: ok, perm: 'members.remove', emits: ['principal.reactivated'], audit: 'always', tool: 'meta', team: true }),
    read('members.remove_preview', 'Removal wizard: each kind of thing the person owns, its default action and the transfer diff', {
      ...V, in: { personId: id.user },
      out: { items: t.arr(t.obj({ kind: removalKind, count: t.int({ minimum: 0 }), defaultAction: removalAction, options: t.arr(removalAction), reassignTo: t.opt(id.user), sample: t.arr(t.obj({ type: t.str(), id: t.str(), title: t.str() })) })), exportUntil: t.ts() },
      perm: 'members.remove', tool: 'meta', team: true,
    }),
    write('members.remove', 'Remove a person with the wizard plan: reassign owned things, pause routines, revoke mailbox connections, rotate the Space key epoch', {
      ...V, in: { personId: id.user, plan: t.arr(t.obj({ kind: removalKind, action: removalAction, to: t.opt(id.user) })), reason: t.opt(t.str()) }, out: ok,
      perm: 'members.remove', emits: ['member.removed', 'member.removal_plan_applied', 'principal.suspended'], gate: { act: 'delete', when: "actor.kind != 'person'" }, audit: 'always', risk: 'high', tool: 'meta', team: true, errors: ['permission.on_hold'],
    }),

    // ---- sign-in policy, second factor, SSO
    read('members.sign_in_policy.get', 'The Space sign-in policy: second-factor floor, SSO required, allowed methods', { ...V, in: {}, out: { policy }, perm: 'policy.manage', tool: 'engineer', team: true }),
    write('members.sign_in_policy.set', 'Set the sign-in policy (owner floor: nobody goes below it)', { ...V, in: { policy }, out: { policy }, perm: 'policy.manage', emits: ['policy.changed'], audit: 'always', risk: 'high', tool: 'engineer', team: true }),
    read('members.second_factor.report', 'Who has a second factor and who does not (when the floor is on, the ones locked out soon)', {
      ...V, in: { ...pageIn }, out: { people: t.arr(t.obj({ person: principalRef, name: t.str(), factors: t.arr(t.enm('totp', 'passkey')) })), ...pageOut }, perm: 'policy.manage', tool: 'engineer', team: true,
    }),
    read('members.sso.list', 'List SSO providers set for this Space', { ...V, in: {}, out: { providers: t.arr(ssoRow) }, perm: 'policy.manage', tool: 'engineer', team: true }),
    write('members.sso.set', 'Add or change an OIDC provider (Google, Microsoft, Okta); the client secret is a Vault item named by handle', { ...V, in: { provider: ssoRow }, out: { provider: ssoRow }, perm: 'policy.manage', emits: ['policy.changed'], audit: 'always', tool: 'engineer', team: true }),
    write('members.sso.remove', 'Remove an SSO provider', { ...V, in: { key: t.enm('google', 'microsoft', 'okta') }, out: ok, perm: 'policy.manage', emits: ['policy.changed'], audit: 'always', tool: 'engineer', team: true }),
    read('members.sso.test', 'Test an SSO provider: discovery document, keys and redirect', { ...V, in: { key: t.enm('google', 'microsoft', 'okta') }, out: { ok: t.bool(), detail: t.opt(t.str()) }, perm: 'policy.manage', tool: 'engineer', team: true }),
  ],

  screens: [
    screen('members.invite_sheet', 'console', 'ui:InviteSheet', { slot: 'sheet', needs: ['members.invite'], q: { invites: ['members.invites.list', { state: '/state/state' }] }, a: { create: ['members.invites.create', { role: '/state/role', email: '/state/email', groups: '/state/groups', agents: '/state/agents', projects: '/state/projects', channels: '/state/channels', expiresInDays: '/state/expiresInDays' }], revoke: ['members.invites.revoke', { inviteId: '/state/inviteId' }, 'Revoke this invite?'] }, empty: 'No open invites', primary: 'Invite a person' }),
    screen('members.remove_wizard', 'console', 'ui:RemoveWizard', { slot: 'sheet', needs: ['members.remove'], q: { preview: ['members.remove_preview', { personId: '/state/personId' }] }, a: { remove: ['members.remove', { personId: '/state/personId', plan: '/state/plan', reason: '/state/reason' }, 'Remove this person and apply the plan?'], suspend: ['members.suspend', { personId: '/state/personId' }] } }),
    screen('members.sign_in_policy', 'console', 'ui:ConsoleSignInPolicy', { needs: ['policy.manage'], q: { policy: ['members.sign_in_policy.get'], sso: ['members.sso.list'], report: ['members.second_factor.report'] }, a: { set: ['members.sign_in_policy.set', { policy: '/state/policy' }], save_sso: ['members.sso.set', { provider: '/state/provider' }], remove_sso: ['members.sso.remove', { key: '/state/key' }, 'Remove this provider?'], test_sso: ['members.sso.test', { key: '/state/key' }] } }),
  ],

  settings: [
    setting('members.invite_expiry_days', 'space', 'console.access', 'Invites expire after', t.int({ minimum: 1, maximum: 90 }), 7),
    setting('members.default_role', 'space', 'console.access', 'Role a new invite starts with', t.str(), 'member'),
    setting('signin.second_factor', 'space', 'console.access', 'Require a second factor', t.enm('off', 'required'), 'off', { floorable: true }),
    setting('signin.require_sso', 'space', 'console.access', 'Require single sign-on', t.bool(), false, { floorable: true }),
  ],
});
