// members (lane L7a): invites, the join page accept, suspend and the removal wizard with transfer preview, SSO (OIDC) and second-factor config.
// members.invites.preview and members.accept run before the person is a member: caller 'pending', never exposed to agents. The join accept screen declares the same caller kind.
// DECISION: members.accept creates the person and session, then stores the wrapped keys by calling identity.keys_put; it emits member.joined and principal.created itself.
// DECISION: sign-in policy (second-factor floor, SSO required, allowed methods) is written as policies of kind sign_in through members.sign_in_policy.set, which emits policy.changed; the settings rows below mirror the values for Cmd-F search.
import { defineManifest, ev, read, screen, t, write } from '../packages/contracts/src/index.ts';
import { id, email, ok, pageIn, pageOut, principalRef } from './_common.ts';

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
const ssoRow = t.obj({ key: t.enm('google', 'microsoft', 'okta'), title: t.str(), issuer: t.str({ maxLength: 300 }), clientId: t.str(), clientSecretHandle: id.handle, enabled: t.bool(), domainHint: t.opt(t.str()) });
const githubApp = t.obj({ clientId: t.opt(t.str()), secretSet: t.bool(), source: t.enm('env', 'space', 'none'), callbackUrl: t.str(), createUrl: t.str() });
const policy = t.obj({ secondFactor: t.enm('off', 'required'), requireSso: t.bool(), allowPassword: t.bool(), allowGithub: t.bool() });

// Connect your company (company.*). One flow for Google Workspace or Microsoft 365: Space-wide sign-in, the directory, and each member's Inbox, Calendar and Files with no per-person sign-in.
// DECISION: this module holds where the flow stands and nothing else. The truth stays with the connectors, the sign-in policy and the Vault, read live, so it survives a restart and never asks twice.
// DECISION: the two calls that change the company declare connection_change. Everything else is a read, a check, or the flow's own note of which provider was chosen, and changes nothing outside.
// DECISION: no secret passes through here. A person's own screen puts a key in the Vault; capabilities name handles.
const companyProvider = t.enm('google', 'microsoft');
const companyData = t.obj({ mail: t.bool(), calendar: t.bool(), files: t.bool() });
const companyStep = t.obj({ id: t.str(), title: t.str(), doc: t.str(), done: t.bool(), optional: t.opt(t.bool()) });
const companyStatusOut = {
  started: t.bool(), providers: t.opt(t.arr(t.obj({ key: companyProvider, title: t.str() }))), provider: t.opt(companyProvider), title: t.opt(t.str()), data: t.opt(companyData), doc: t.opt(t.str()), steps: t.opt(t.arr(companyStep)), next: t.opt(t.str()),
  requireSso: t.opt(t.bool()), signInOn: t.opt(t.bool()), signInTried: t.opt(t.bool()), recoveryKey: t.opt(t.bool()), domain: t.opt(t.str()), tenant: t.opt(t.str()), who: t.opt(t.str()), probeLine: t.opt(t.str()), keyHandle: t.opt(t.str()), connected: t.opt(t.bool()), connectedAt: t.opt(t.ts()), mapped: t.opt(t.int()), excluded: t.opt(t.arr(email)), space: t.opt(t.str()), redirect: t.opt(t.str()), clientId: t.opt(t.str()), lastSweep: t.opt(t.str()),
};

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
    read('members.invites.preview', 'Join page: the public Space routing id, name and logo, who invited, expiry and display fingerprint for a code', {
      ...V, caller: 'pending', in: { code: t.str() }, out: { spaceId: id.space, spaceName: t.str(), logoFileId: t.opt(id.file), invitedBy: t.str(), role: t.str(), expiresAt: t.ts(), fingerprint: t.str({ examples: ['ab12 cd34 ef56 7890'] }), ssoRequired: t.opt(t.arr(t.obj({ key: t.str(), title: t.str() }))) }, errors: ['auth.invalid_code', 'auth.expired'],
    }),
    write('members.accept', 'Accept an invite: pick a username and password, the device makes its keys; the person becomes active', {
      ...V, caller: 'pending', in: { code: t.str(), username: t.str({ pattern: '^[a-z0-9_.-]{2,32}$', examples: ['maya'] }), displayName: t.opt(t.str()), password: t.str(), deviceName: t.str(), deviceClass, keys: keyBundle, ssoProvider: t.opt(t.str()) },
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
    read('members.sign_in_policy.get', 'The Space sign-in policy: second-factor floor, SSO required, allowed methods', { ...V, in: {}, out: { policy, capabilities: t.opt(t.obj({password:t.bool(),github:t.bool(),sso:t.arr(t.str()),newMemberMfaEnrollment:t.bool(),ownerHasSecondFactor:t.bool(),currentHasSecondFactor:t.bool(),ownerSsoLinked:t.opt(t.bool()),ownerHasRecovery:t.opt(t.bool())})) }, perm: 'policy.manage', tool: 'engineer', team: true }),
    write('members.sign_in_policy.set', 'Set the sign-in policy (owner floor: nobody goes below it)', { ...V, in: { policy }, out: { policy }, perm: 'policy.manage', gate: { act: 'signin_change', when: "actor.kind != 'person'" }, emits: ['policy.changed'], audit: 'always', risk: 'high', tool: 'engineer', team: true }),
    read('members.second_factor.report', 'Who has a second factor and who does not (when the floor is on, the ones locked out soon)', {
      ...V, in: { ...pageIn }, out: { people: t.arr(t.obj({ person: principalRef, name: t.str(), factors: t.arr(t.enm('totp', 'passkey')) })), ...pageOut }, perm: 'policy.manage', tool: 'engineer', team: true,
    }),
    read('members.sign_in_github.get', 'The GitHub sign-in app: the client id, whether the secret is set (never the secret), where it comes from, and the callback address to register at GitHub', { ...V, in: {}, out: { github: githubApp }, perm: 'policy.manage' , tool: 'engineer', team: true }),
    write('members.sign_in_github.set', 'Turn on GitHub sign-in: the OAuth app client id and secret; the secret goes into the Vault as a Space item and is never shown again', { ...V, in: { clientId: t.str(), clientSecret: t.opt(t.str()) }, out: { github: githubApp }, perm: 'policy.manage', gate: { act: 'signin_change', when: "actor.kind != 'person'" }, emits: ['policy.changed'], audit: 'always', risk: 'high' , tool: 'engineer', team: true }),
    write('members.sign_in_github.clear', 'Forget the GitHub sign-in app set in the app (a server environment setting stays)', { ...V, in: {}, out: { github: githubApp }, perm: 'policy.manage', gate: { act: 'signin_change', when: "actor.kind != 'person'" }, emits: ['policy.changed'], audit: 'always', risk: 'high' , tool: 'engineer', team: true }),
      read('company.status', 'Where Connect your company stands: the provider, each step and whether it is done, the next step, and which doc section explains it. Read this first; it never asks twice', { in: {}, out: companyStatusOut, perm: 'connectors.manage', tool: 'engineer' }),
      write('company.start', 'Start Connect your company for Google Workspace or Microsoft 365 and choose Mail, Calendar and Files, or pick it up where it stands', {
        in: { provider: companyProvider, data: t.opt(companyData) }, out: companyStatusOut, perm: 'connectors.manage', audit: 'always', tool: 'engineer', errors: ['validation.precondition_failed'],
      }),
      read('company.script', 'The one paste that does the provider\'s side: which shell to open and the script. It holds no secret; the admin runs it under their own account', {
        in: { provider: companyProvider }, out: { shell: t.str(), url: t.str(), script: t.str() }, perm: 'connectors.manage', tool: 'engineer',
      }),
      read('company.guide', 'The guide for a step of Connect your company, or all of it: the doc page itself', {
        in: { provider: companyProvider, section: t.opt(t.str()) }, out: { text: t.str() }, perm: 'connectors.manage', tool: 'engineer', errors: ['validation.not_found'],
      }),
      write('company.check', 'Prove the key now in the Vault works, with no person involved. Answers what is wrong in plain words, or who it is; never the key. A key that works is remembered', {
        in: {}, out: { ok: t.bool(), problem: t.opt(t.str()), clientId: t.opt(t.str()), who: t.opt(t.str()), tenantId: t.opt(t.str()), credential: t.opt(t.enm('certificate', 'secret')) }, perm: 'connectors.manage', audit: 'always', tool: 'engineer', errors: ['validation.precondition_failed'],
      }),
      write('company.people_done', 'A person has looked at who is in; the flow moves on to the one confirmation', { in: {}, out: companyStatusOut, perm: 'connectors.manage', audit: 'always', tool: 'engineer' }),
      write('company.probe', 'The read-only check of what the company allowed, as one line a person can act on', {
        in: {}, out: { ok: t.bool(), line: t.str(), missing: t.opt(t.arr(t.str())) }, perm: 'connectors.manage', audit: 'always', tool: 'engineer', errors: ['validation.precondition_failed', 'provider.auth_failed'],
      }),
      write('company.connect', 'The one confirmation: everyone included comes in, and the directory is watched from here on', {
        in: {}, out: { connected: t.int(), included: t.int() }, perm: 'connectors.manage', risk: 'high', idem: 'key', audit: 'always', tool: 'engineer', gate: { act: 'connection_change', when: "actor.kind != 'person'" }, errors: ['validation.precondition_failed', 'permission.on_hold'],
      }),
      write('company.disconnect', 'Undo: every member sync stops at once; what already came in stays with its owner', {
        in: {}, out: { disconnected: t.bool() }, perm: 'connectors.manage', risk: 'high', audit: 'always', tool: 'engineer', gate: { act: 'connection_change', when: "actor.kind != 'person'" }, errors: ['permission.on_hold'],
      }),
      write('company.sweep', 'Check the directory: a person gone from it stops and loses access. Runs on a schedule; a person confirms a change large enough to be held', {
        in: { confirmed: t.opt(t.bool()) }, out: { checked: t.int(), gone: t.arr(email), held: t.opt(t.str()) }, perm: 'connectors.manage', audit: 'always', tool: 'engineer',
      }),
      read('company.access_log', 'Who reached whose mail, calendar or files: who made the call, the person an agent worked for, which mailbox, when', {
        in: { ...pageIn, mailbox: t.opt(email) }, out: { entries: t.arr(t.obj({ who: t.str(), onBehalf: t.opt(t.str()), mailbox: t.str(), cap: t.str(), at: t.ts() })), next: t.opt(t.str()) }, perm: 'connectors.manage', tool: 'engineer',
      }),
    read('members.sso.list', 'List SSO providers set for this Space', { ...V, in: {}, out: { providers: t.arr(ssoRow) }, perm: 'policy.manage', tool: 'engineer', team: true }),
    write('members.sso.set', 'Add or change an OIDC provider (Google, Microsoft, Okta); the client secret is a Vault item named by handle', { ...V, in: { provider: ssoRow }, out: { provider: ssoRow }, perm: 'policy.manage', gate: { act: 'signin_change', when: "actor.kind != 'person'" }, emits: ['policy.changed'], audit: 'always', tool: 'engineer', team: true }),
    write('members.sso.remove', 'Remove an SSO provider', { ...V, in: { key: t.enm('google', 'microsoft', 'okta') }, out: ok, perm: 'policy.manage', gate: { act: 'signin_change', when: "actor.kind != 'person'" }, emits: ['policy.changed'], audit: 'always', tool: 'engineer', team: true }),
    read('members.sso.test', 'Test an SSO provider: discovery document, keys and redirect', { ...V, in: { key: t.enm('google', 'microsoft', 'okta') }, out: { ok: t.bool(), detail: t.opt(t.str()) }, perm: 'policy.manage', tool: 'engineer', team: true }),
  ],

  screens: [
    screen('company.setup', 'console', 'ui:ConnectCompany', {
      q: { status: ['company.status', {}, true] }, a: { start: ['company.start', { provider: '/state/provider' }], check: ['company.check', {}], probe: ['company.probe', {}], connect: ['company.connect', {}, 'Bring everyone included in?'], disconnect: ['company.disconnect', {}, 'Stop every member sync?'] },
      empty: 'Your company is not connected', primary: 'Connect your company', needs: ['connectors.manage'],
    }),
    screen('join.accept', 'join', 'ui:JoinAccept', {
      caller: 'pending', q: { invite: ['members.invites.preview', { code: '/state/code' }, false] },
      a: { accept: ['members.accept', { code: '/state/code', username: '/state/username', displayName: '/state/displayName', password: '/state/password', deviceName: '/state/deviceName' }] },
      empty: 'This invite is not valid', primary: 'Continue',
    }),
    screen('join.checklist', 'join', 'ui:JoinChecklist', { q: { checklist: ['home.checklist', {}, true] }, a: { dismiss: ['home.dismiss_checklist', {}] }, empty: 'All set' }),
    screen('members.invite_sheet', 'console', 'ui:InviteSheet', { slot: 'sheet', needs: ['members.invite'], q: { invites: ['members.invites.list', { state: '/state/state' }] }, a: { create: ['members.invites.create', { role: '/state/role', email: '/state/email', groups: '/state/groups', agents: '/state/agents', projects: '/state/projects', channels: '/state/channels', expiresInDays: '/state/expiresInDays' }], revoke: ['members.invites.revoke', { inviteId: '/state/inviteId' }, 'Revoke this invite?'] }, empty: 'No open invites', primary: 'Invite a person' }),
    screen('members.remove_wizard', 'console', 'ui:RemoveWizard', { slot: 'sheet', needs: ['members.remove'], q: { preview: ['members.remove_preview', { personId: '/state/personId' }] }, a: { remove: ['members.remove', { personId: '/state/personId', plan: '/state/plan', reason: '/state/reason' }, 'Remove this person and apply the plan?'], suspend: ['members.suspend', { personId: '/state/personId' }] } }),
    screen('members.sign_in_policy', 'console', 'ui:ConsoleSignInPolicy', { needs: ['policy.manage'], q: { policy: ['members.sign_in_policy.get'], github: ['members.sign_in_github.get'], sso: ['members.sso.list'], report: ['members.second_factor.report'] }, a: { set: ['members.sign_in_policy.set', { policy: '/state/policy' }], save_github: ['members.sign_in_github.set', { clientId: '/state/clientId', clientSecret: '/state/clientSecret' }], clear_github: ['members.sign_in_github.clear', {}, 'Forget the GitHub app?'], save_sso: ['members.sso.set', { provider: '/state/provider' }], remove_sso: ['members.sso.remove', { key: '/state/key' }, 'Remove this provider?'], test_sso: ['members.sso.test', { key: '/state/key' }] } }),
  ],

});
