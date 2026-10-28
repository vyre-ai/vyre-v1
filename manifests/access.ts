// access (lane L7a): roles, groups, grants, policies, labels, outside actors, access reviews, View as, the Access checker,
// generic folders and sharing (4.12) and Ask for access (4.13). Imports and exports the permission catalogue.
// access.share, access.request, access.labels.set, folders.place and the star and follow toggles take a typed ResourceRef input; the binding is 'dynamic' and the gateway authorizes the type and id it names.
// Vault Use and View follow the vault ladder in contracts/src/levels.ts (use < view < edit < manage); other types use view < use < edit < manage.
// DECISION: capabilities that need only a Space member and a role permission bind level 'view' on the Space; the permission key is the real gate.
// DECISION: folder.created, folder.renamed, folder.moved and folder.deleted are declared by module files; the generic folders.* capabilities emit those same events for the shared folder resource.
// DECISION: the group entity is added to the six entities named by the brief because the people directory and role pages need group membership offline.
import { block, defineManifest, entity, ev, health, read, screen, setting, t, write } from '../packages/contracts/src/index.ts';
import { PERMISSIONS } from './permissions.ts';
import { id, label, level, ok, pageIn, pageOut, principalRef, resourceRef, resourceType, subjectRef } from './_common.ts';

const V = { level: 'view' } as const;
const pid = t.str({ pattern: '^(usr|agt|act|svc)_[a-z0-9]+$', examples: ['usr_a1b2c3'] });
const section = t.enm('personal', 'shared', 'space', 'starred', 'following');
const via = t.enm('owner', 'grant', 'folder', 'space');

const conditions = t.obj({
  rowFilter: t.opt(t.json()),   // expression subset that compiles to SQL: field op value, owner = me, AND/OR
  hiddenFields: t.opt(t.arr(t.str())),
  labelCeiling: t.opt(label),
  window: t.opt(t.obj({ from: t.ts(), to: t.ts() })),
  expiresAt: t.opt(t.ts()),
});
const roleHolderRef = t.obj({ kind: t.enm('person', 'agent', 'actor', 'service', 'group'), id: t.str({ pattern: '^(usr|agt|act|svc|grp)_[a-z0-9]+$', examples: ['usr_a1b2c3'] }) });
const principalRow = t.obj({
  id: pid, kind: t.enm('person', 'agent', 'actor', 'service'), name: t.str(), owner: t.opt(pid),
  status: t.enm('invited', 'active', 'suspended', 'removed'), roles: t.arr(id.role), groups: t.arr(id.group),
  title: t.opt(t.str()), createdAt: t.ts(),
});
const roleRow = t.obj({
  id: id.role, name: t.str(), builtIn: t.bool(), clearance: label, assignableToAgents: t.bool(),
  permissions: t.arr(t.str()), holders: t.int({ minimum: 0 }),
});
const groupRow = t.obj({ id: id.group, name: t.str(), members: t.arr(principalRef), managers: t.arr(principalRef), builtIn: t.bool() });
const grantRow = t.obj({
  id: id.grant, subject: subjectRef, resource: resourceRef, level, conditions, by: t.str(), source: t.opt(t.str()), createdAt: t.ts(),
});
const policyRow = t.obj({
  key: t.str({ examples: ['gate.send'] }), scope: t.str({ examples: ['space'] }),
  kind: t.enm('gate', 'spend', 'limit', 'provider_label', 'retention', 'sign_in', 'sharing', 'vault'), value: t.json(), updatedAt: t.ts(),
});
const folderRow = t.obj({
  id: id.folder, type: resourceType, name: t.str(), parentId: t.opt(id.folder), scope: t.enm('personal', 'space'), owner: t.str(), count: t.int({ minimum: 0 }),
});
const listRow = t.obj({
  type: resourceType, id: t.str({ examples: ['rec_a1b2c3'] }), title: t.str(), via, level, folderId: t.opt(id.folder), starred: t.bool(), following: t.bool(),
});
const stepRow = t.obj({ ok: t.bool(), text: t.str() });
const decision = t.obj({ effect: t.enm('allow', 'deny', 'hold'), reason: t.str({ examples: ['ok'] }), steps: t.arr(stepRow), decisionId: t.str() });
const actorRow = t.obj({
  id: id.actor, name: t.str(), owner: id.user, provider: t.str({ examples: ['anthropic'] }), roles: t.arr(id.role),
  status: t.enm('pending', 'active', 'revoked'), engineerMcp: t.bool(), lastSeenAt: t.opt(t.ts()),
});
const reviewRow = t.obj({
  id: t.id('rvw'), state: t.enm('open', 'closed'), openedAt: t.ts(), closedAt: t.opt(t.ts()), items: t.int({ minimum: 0 }), decided: t.int({ minimum: 0 }),
});
const requestRow = t.obj({
  id: t.id('arq'), requester: id.user, resource: resourceRef, level, note: t.opt(t.str()),
  state: t.enm('waiting', 'granted', 'declined'), taskId: id.task, at: t.ts(),
});

export default defineManifest({
  id: 'access',
  title: 'Access',
  owner: 'L7a',
  permissions: PERMISSIONS,

  events: [
    ev('access.changed', 'Roles, groups, labels or membership changed; bumps the authorize cache epoch', { p: { epoch: t.int(), what: t.enm('role', 'group', 'membership', 'label', 'actor', 'assignment'), by: t.str() }, subject: ['entity', '/epoch'], retention: 'audit' }),
    ev('grant.created', 'A grant was given to a person, group, role or link', { p: { grantId: id.grant, subject: subjectRef, resource: resourceRef, level, source: t.opt(t.str()) }, subject: ['entity', '/grantId'], retention: 'audit' }),
    ev('grant.updated', 'The level, conditions or expiry of a grant changed', { p: { grantId: id.grant, level, expiresAt: t.opt(t.ts()) }, subject: ['entity', '/grantId'], retention: 'audit' }),
    ev('access.everyone_defaults_changed', 'The default grants of the Everyone group changed', { p: { grants: t.int({ minimum: 0 }), by: t.str() }, subject: ['entity', '/by'], retention: 'audit' }),
    ev('grant.revoked', 'A grant was removed', { p: { grantId: id.grant, subject: subjectRef, resource: resourceRef, reason: t.opt(t.str()) }, subject: ['entity', '/grantId'], retention: 'audit' }),
    ev('policy.changed', 'A Space policy was set or reset (Gate rule, spend, label rule, sign-in, sharing, retention, vault)', { p: { key: t.str(), scope: t.str(), kind: t.str(), by: t.str() }, subject: ['entity', '/key'], retention: 'audit' }),
    ev('principal.created', 'A person, agent, outside actor or service came to exist', { p: { principalId: pid, kind: t.enm('person', 'agent', 'actor', 'service'), owner: t.opt(pid) }, subject: ['entity', '/principalId'], retention: 'audit' }),
    ev('principal.suspended', 'A principal was suspended', { p: { principalId: pid, reason: t.opt(t.str()) }, subject: ['entity', '/principalId'], retention: 'audit' }),
    ev('principal.reactivated', 'A suspended principal was reactivated', { p: { principalId: pid }, subject: ['entity', '/principalId'], retention: 'audit' }),
    ev('token.revoked', 'An outside actor token was revoked', { p: { actorId: id.actor, by: t.str() }, subject: ['entity', '/actorId'], retention: 'audit' }),
    ev('folder.shared', 'A folder was shared or unshared; everything in it follows', { p: { folderId: id.folder, subject: subjectRef, level: t.opt(level), removed: t.bool() }, subject: ['folder', '/folderId'], retention: 'audit' }),
    // a folder is a Files folder (fld_) or a Vault folder (vfd_): both kinds move items on this one event
    ev('item.moved', 'An item moved into or out of a folder', { p: { resource: resourceRef, fromFolderId: t.opt(t.union(id.folder, id.vaultFolder)), toFolderId: t.opt(t.union(id.folder, id.vaultFolder)) }, subject: ['entity', '/resource/id'] }),
    ev('access.requested', 'Someone asked for access to a resource', { p: { requestId: t.id('arq'), resource: resourceRef, level, requester: id.user, taskId: id.task }, subject: ['entity', '/requestId'], notify: 'access.requested', trigger: { title: 'Someone asks for access' } }),
    ev('access.granted', 'An access request was approved', { p: { requestId: t.id('arq'), resource: resourceRef, level, requester: id.user, grantId: id.grant }, subject: ['entity', '/requestId'], notify: 'access.decided', retention: 'audit' }),
    ev('access.declined', 'An access request was declined; the note goes back to the requester', { p: { requestId: t.id('arq'), resource: resourceRef, requester: id.user, note: t.opt(t.str()) }, subject: ['entity', '/requestId'], notify: 'access.decided' }),
    ev('access_review.opened', 'A quarterly access review opened and made its tasks', { p: { reviewId: t.id('rvw'), items: t.int() }, subject: ['entity', '/reviewId'] }),
    ev('access_review.closed', 'An access review closed', { p: { reviewId: t.id('rvw'), kept: t.int(), removed: t.int() }, subject: ['entity', '/reviewId'], retention: 'audit' }),
    ev('view_as.started', 'An admin previewed what another person sees (audited)', { p: { target: pid, expiresAt: t.ts() }, subject: ['entity', '/target'], retention: 'audit' }),
  ],

  capabilities: [
    // ---- people and other principals
    read('access.principals.list', 'List principals (people, agents, outside actors, services) with roles and groups', { ...V, in: { kind: t.opt(t.enm('person', 'agent', 'actor', 'service')), status: t.opt(t.enm('invited', 'active', 'suspended', 'removed')), q: t.opt(t.str()), ...pageIn }, out: { principals: t.arr(principalRow), ...pageOut }, tool: 'meta', cli: 'vyre access principals' }),
    read('access.principals.get', 'Read one principal', { ...V, in: { principal: principalRef }, out: { principal: principalRow }, tool: 'meta' }),
    read('access.principals.effective', 'Effective permissions, grants held and things owned for one principal (computed)', { ...V, in: { principal: principalRef }, out: { permissions: t.arr(t.str()), roles: t.arr(id.role), grants: t.arr(grantRow), owns: t.arr(resourceRef) }, perm: 'access.manage', tool: 'engineer' }),

    // ---- roles
    read('access.roles.list', 'List roles with their permissions, clearance and holder counts', { ...V, in: { q: t.opt(t.str()), ...pageIn }, out: { roles: t.arr(roleRow), ...pageOut }, tool: 'meta' }),
    read('access.roles.get', 'Read one role with holders and where it is granted', { ...V, in: { roleId: id.role }, out: { role: roleRow, holders: t.arr(principalRef), directHolders: t.opt(t.arr(roleHolderRef)), lastChange: t.opt(t.obj({ before: t.arr(t.str()), after: t.arr(t.str()), by: principalRef, at: t.int() })) }, tool: 'meta' }),
    write('access.roles.create', 'Create a custom role, usually by cloning a built-in one', { ...V, idem: 'key', in: { name: t.str(), cloneFrom: t.opt(id.role), clearance: t.opt(label), assignableToAgents: t.opt(t.bool()) }, out: { role: roleRow }, perm: 'access.manage', emits: ['access.changed'], audit: 'always', tool: 'engineer', errors: ['validation.duplicate'] }),
    write('access.roles.update', 'Rename a custom role or change its clearance; built-in roles are locked', { ...V, in: { roleId: id.role, name: t.opt(t.str()), clearance: t.opt(label), assignableToAgents: t.opt(t.bool()) }, out: { role: roleRow }, perm: 'access.manage', emits: ['access.changed'], audit: 'always', tool: 'engineer', errors: ['validation.field_locked', 'validation.duplicate'] }),
    read('access.roles.preview', 'Stage a change to the permissions of a role as a diff: who gains and who loses what', { ...V, in: { roleId: id.role, permissions: t.arr(t.str()) }, out: { gains: t.arr(t.obj({ principal: principalRef, permission: t.str() })), losses: t.arr(t.obj({ principal: principalRef, permission: t.str() })), previewHash: t.str() }, perm: 'access.manage', tool: 'engineer' }),
    write('access.roles.apply', 'Apply a staged role permission change (the diff from preview)', { ...V, in: { roleId: id.role, permissions: t.arr(t.str()), previewHash: t.str() }, out: { role: roleRow }, perm: 'access.manage', emits: ['access.changed'], audit: 'always', tool: 'engineer', errors: ['validation.field_locked', 'validation.precondition_failed'] }),
    write('access.roles.delete', 'Delete a custom role; blocked while anyone holds it', { ...V, in: { roleId: id.role }, out: { deleted: t.bool() }, perm: 'access.manage', emits: ['access.changed'], audit: 'always', tool: 'engineer', errors: ['validation.field_locked', 'validation.precondition_failed'] }),
    write('access.roles.assign', 'Give a role to a person, group or agent (agents never get Owner or Admin)', { ...V, in: { subject: roleHolderRef, roleId: id.role }, out: { roles: t.arr(id.role) }, perm: 'access.manage', emits: ['access.changed'], audit: 'always', tool: 'engineer', errors: ['validation.precondition_failed'] }),
    write('access.roles.unassign', 'Take a role away from a person, group or agent', { ...V, in: { subject: roleHolderRef, roleId: id.role }, out: { roles: t.arr(id.role) }, perm: 'access.manage', emits: ['access.changed'], audit: 'always', tool: 'engineer', errors: ['validation.precondition_failed'] }),

    // ---- groups (one level, no nesting)
    read('access.groups.list', 'List groups', { ...V, in: { q: t.opt(t.str()), ...pageIn }, out: { groups: t.arr(groupRow), ...pageOut }, tool: 'meta' }),
    read('access.groups.get', 'Read one group with members, managers, roles and grants given to it', { ...V, in: { groupId: id.group }, out: { group: groupRow, roles: t.arr(id.role), grants: t.arr(grantRow) }, tool: 'meta' }),
    write('access.groups.create', 'Create a group of people and agents', { ...V, idem: 'key', in: { name: t.str(), members: t.opt(t.arr(principalRef)), managers: t.opt(t.arr(principalRef)) }, out: { group: groupRow }, perm: 'access.manage', emits: ['access.changed'], audit: 'always', tool: 'engineer', errors: ['validation.duplicate'] }),
    write('access.groups.update', 'Rename a group or change its managers', { ...V, in: { groupId: id.group, name: t.opt(t.str()), managers: t.opt(t.arr(principalRef)) }, out: { group: groupRow }, perm: 'access.manage', emits: ['access.changed'], audit: 'always', tool: 'engineer', errors: ['validation.field_locked'] }),
    write('access.groups.delete', 'Delete a group; grants given to it go with it', { ...V, in: { groupId: id.group }, out: { deleted: t.bool() }, perm: 'access.manage', emits: ['access.changed', 'grant.revoked'], audit: 'always', tool: 'engineer', errors: ['validation.field_locked'] }),
    write('access.groups.add_member', 'Add a person or agent to a group (groups hold no groups)', { ...V, in: { groupId: id.group, member: principalRef }, out: { group: groupRow }, perm: 'access.manage', emits: ['access.changed'], audit: 'always', tool: 'engineer', errors: ['validation.precondition_failed'] }),
    write('access.groups.remove_member', 'Remove a person or agent from a group', { ...V, in: { groupId: id.group, member: principalRef }, out: { group: groupRow }, perm: 'access.manage', emits: ['access.changed'], audit: 'always', tool: 'engineer' }),
    read('access.groups.defaults_get', 'Default grants of the built-in Everyone group (every member holds them; Kits ship the first set and invites add new people to the group)', { ...V, out: { groupId: id.group, grants: t.arr(t.obj({ resource: resourceRef, level })) }, tool: 'meta' }),
    write('access.groups.defaults_set', 'Replace the default grants of the Everyone group; the sheet shows who gains what, then applies', { ...V, in: { grants: t.arr(t.obj({ resource: resourceRef, level })) }, out: { groupId: id.group, grants: t.arr(t.obj({ resource: resourceRef, level })) }, perm: 'access.manage', emits: ['access.everyone_defaults_changed', 'access.changed'], audit: 'always', tool: 'engineer' }),

    // ---- grants and sharing (no explicit deny grants exist)
    write('access.share', 'Give a person, group, role, agent or automation a level on a resource (flows down; folders cover their items)', {
      ...V, idem: 'key', in: { resource: resourceRef, subject: subjectRef, level, conditions: t.opt(conditions), source: t.opt(t.str({ description: "Source tag, for example 'project:prj_a1b2c3'; removing the member revokes by source" })) },
      out: { grant: grantRow }, emits: ['grant.created', 'access.changed', 'folder.shared'], audit: 'always', tool: 'meta', errors: ['permission.not_contained', 'validation.precondition_failed'], team: true,
    }),
    write('access.unshare', 'Remove a grant, or every grant of one source on a resource', { ...V, in: { grantId: t.opt(id.grant), resource: t.opt(resourceRef), subject: t.opt(subjectRef), source: t.opt(t.str()) }, out: { revoked: t.int({ minimum: 0 }) }, emits: ['grant.revoked', 'access.changed', 'folder.shared'], audit: 'always', tool: 'meta', team: true }),
    read('access.shares_of', 'Who has access to a resource, through what (direct, group, role, folder), with conditions and expiry', { ...V, in: { resource: resourceRef }, out: { shares: t.arr(t.obj({ grant: grantRow, through: t.enm('direct', 'group', 'role', 'folder', 'owner') })) }, tool: 'meta' }),
    read('access.grants.list', 'List grants by resource, subject or source (Console Grants)', { ...V, in: { resource: t.opt(resourceRef), subject: t.opt(subjectRef), source: t.opt(t.str()), ...pageIn }, out: { grants: t.arr(grantRow), ...pageOut }, perm: 'access.manage', tool: 'engineer' }),
    write('access.grants.update', 'Change the level, conditions or expiry of a grant', { ...V, in: { grantId: id.grant, level: t.opt(level), conditions: t.opt(conditions) }, out: { grant: grantRow }, emits: ['grant.updated', 'access.changed'], audit: 'always', tool: 'meta', team: true, errors: ['permission.not_contained'] }),
    read('access.lists', 'Items of one type in a section (Personal, Shared with me, Space, Starred, Following) with folder counts', {
      ...V, in: { type: resourceType, section: t.opt(section), folder: t.opt(id.folder), ...pageIn },
      out: { rows: t.arr(listRow), counts: t.rec(t.int({ minimum: 0 })), ...pageOut }, tool: 'meta', label: 'filter',
    }),

    // ---- Ask for access (4.13)
    write('access.request', 'Ask the Manage holders of a resource (or the admins, for a permission) for access; one open request per person and resource', {
      // Any member may ask for any resource id (space: true binds the Space, not the thing asked for): a link to something you cannot see must still let you ask. The answer is the same whether or not
      // the resource exists or the asker can view it, and the handler rate-limits each requester across real and made-up ids alike.
      // level 'member' (ruling 69): view on the Space is not needed to ask, any role or grant is, so a guest or temp whose only grant is one folder can still ask for another thing.
      ...V, level: 'member', space: true, idem: 'key', in: { resource: resourceRef, level, note: t.opt(t.str()) }, out: { request: requestRow }, emits: ['access.requested'], tool: 'meta', errors: ['permission.guest_cannot_request', 'validation.duplicate', 'rate_limit.exceeded'], team: true,
    }),
    read('access.requests.list', 'Access requests I made, or waiting on me to decide', { ...V, in: { mine: t.opt(t.bool()), state: t.opt(t.enm('waiting', 'granted', 'declined')), ...pageIn }, out: { requests: t.arr(requestRow), ...pageOut }, tool: 'meta' }),
    write('access.requests.approve', 'Approve an access request: shares as the approver and tells the requester', { ...V, in: { requestId: t.id('arq'), level: t.opt(level) }, out: { grant: grantRow }, emits: ['access.granted', 'grant.created', 'access.changed'], audit: 'always', tool: 'meta', team: true, errors: ['permission.not_contained'] }),
    write('access.requests.decline', 'Decline an access request with a note for the requester', { ...V, in: { requestId: t.id('arq'), note: t.opt(t.str()) }, out: ok, emits: ['access.declined'], tool: 'meta', team: true }),
    write('access.propose_change', 'View-level Ask: store a drafted change for the editors of an object as a changeset or Review task; writes nothing to the object', {
      ...V, idem: 'key', in: { resource: resourceRef, change: t.json(), note: t.opt(t.str()) }, out: { taskId: id.task }, tool: 'meta', team: true,
    }),

    // ---- Access checker and View as
    read('access.check', 'Access checker: can principal P do action A on resource R, with each step in plain words', {
      ...V, space: true, in: { principal: principalRef, actingFor: t.opt(principalRef), action: t.obj({ perm: t.opt(t.str()), level }), resource: resourceRef, fields: t.opt(t.arr(t.str())), provider: t.opt(t.str()) },
      out: { decision }, perm: 'access.manage', tool: 'engineer', team: true,
    }),
    read('access.view_as', 'Preview what a member sees: a read-only preview session for 10 minutes (audited)', {
      ...V, in: { person: id.user }, out: { previewToken: t.str(), expiresAt: t.ts() }, perm: 'access.manage', audit: 'always', emits: ['view_as.started'], tool: 'engineer', team: true,
    }),

    // ---- policies and labels
    read('access.policies.list', 'List Space policies (Gate rules, spend, label rules, sign-in, sharing, retention, vault)', { ...V, in: { kind: t.opt(t.enm('gate', 'spend', 'limit', 'provider_label', 'retention', 'sign_in', 'sharing', 'vault')) }, out: { policies: t.arr(policyRow) }, perm: 'policy.manage', tool: 'engineer' }),
    write('access.policies.set', 'Set a policy value; applies last in the decision', { ...V, in: { key: t.str(), scope: t.str({ examples: ['space'] }), value: t.json() }, out: { policy: policyRow }, perm: 'policy.manage', emits: ['policy.changed'], audit: 'always', tool: 'engineer', team: true }),
    write('access.policies.reset', 'Reset a policy to its default', { ...V, in: { key: t.str(), scope: t.str({ examples: ['space'] }) }, out: ok, perm: 'policy.manage', emits: ['policy.changed'], audit: 'always', tool: 'engineer', team: true }),
    read('access.labels.list', 'The four sensitivity labels with rank, provider rule and laptop-sync rule', { ...V, out: { labels: t.arr(t.obj({ label, rank: t.int({ minimum: 0, maximum: 3 }), providers: t.enm('any', 'approved', 'none'), syncToLaptop: t.bool() })) }, tool: 'meta' }),
    write('access.labels.set', 'Set the sensitivity label of a folder, channel, inbox or other container (items inherit unless set)', { ...V, in: { resource: resourceRef, label }, out: ok, perm: 'policy.manage', emits: ['access.changed'], audit: 'always', tool: 'engineer', team: true }),

    // ---- outside actors (token issue and revoke, Engineer MCP grant)
    read('access.actors.list', 'List outside actors (registered external tools such as Claude Code or Codex)', { ...V, in: { ...pageIn }, out: { actors: t.arr(actorRow), ...pageOut }, perm: 'access.manage', tool: 'engineer' }),
    write('access.actors.create', 'Register an outside actor and issue a one-time token (works once, within 10 minutes)', { ...V, idem: 'key', in: { name: t.str(), provider: t.str({ examples: ['anthropic'] }), roleIds: t.opt(t.arr(id.role)) }, out: { actor: actorRow, oneTimeToken: t.str({ description: 'Shown once; stored only as a hash' }), expiresAt: t.ts() }, perm: 'access.manage', emits: ['principal.created', 'access.changed'], audit: 'always', tool: 'engineer', team: true }),
    write('access.actors.redeem', 'The outside tool trades its one-time token for a registered credential; the actor turns active', { ...V, in: { token: t.str() }, out: { actorId: id.actor, credential: t.str({ description: 'Long-lived actor credential, returned once' }) }, audit: 'always', errors: ['auth.invalid_code', 'permission.expired'], team: true }),
    write('access.actors.update', 'Change the roles or declared provider of an outside actor', { ...V, in: { actorId: id.actor, roleIds: t.opt(t.arr(id.role)), provider: t.opt(t.str()) }, out: { actor: actorRow }, perm: 'access.manage', emits: ['access.changed'], audit: 'always', tool: 'engineer', team: true }),
    write('access.actors.revoke', 'Revoke the token of an outside actor in one click', { ...V, in: { actorId: id.actor }, out: ok, perm: 'access.manage', emits: ['token.revoked', 'access.changed'], audit: 'always', tool: 'engineer', team: true }),
    write('access.actors.set_engineer_mcp', 'Allow or stop an outside actor using the Engineer MCP toolset', { ...V, in: { actorId: id.actor, enabled: t.bool() }, out: { actor: actorRow }, perm: 'access.manage', emits: ['access.changed'], audit: 'always', risk: 'high', tool: 'engineer', team: true }),

    // ---- access reviews (quarterly job makes review tasks)
    read('access.reviews.list', 'List access reviews', { ...V, in: { state: t.opt(t.enm('open', 'closed')), ...pageIn }, out: { reviews: t.arr(reviewRow), ...pageOut }, perm: 'access.manage', tool: 'engineer' }),
    read('access.reviews.get', 'Items of one review: who holds what, last used, decision so far', { ...V, in: { reviewId: t.id('rvw') }, out: { review: reviewRow, items: t.arr(t.obj({ grant: grantRow, reviewer: t.opt(id.user), taskId: t.opt(id.task), lastUsedAt: t.opt(t.ts()), decision: t.opt(t.enm('keep', 'remove')) })) }, perm: 'access.manage', tool: 'engineer' }),
    write('access.reviews.start', 'Open an access review now (the quarterly job calls this too)', { ...V, idem: 'key', in: { scope: t.opt(t.arr(resourceType)) }, out: { review: reviewRow }, perm: 'access.manage', emits: ['access_review.opened'], tool: 'engineer', team: true }),
    write('access.reviews.decide', 'Keep a grant or remove it in one click', { ...V, in: { reviewId: t.id('rvw'), grantId: id.grant, decision: t.enm('keep', 'remove') }, out: ok, perm: 'access.manage', emits: ['grant.revoked', 'access.changed'], audit: 'always', tool: 'engineer', team: true }),
    write('access.reviews.close', 'Close a review', { ...V, in: { reviewId: t.id('rvw') }, out: { review: reviewRow }, perm: 'access.manage', emits: ['access_review.closed'], tool: 'engineer', team: true }),

    // ---- folders and placement (4.12)
    read('folders.list', 'Folders of one type with item counts, as a tree', { ...V, in: { type: resourceType, scope: t.opt(t.enm('personal', 'space')) }, out: { folders: t.arr(folderRow) }, tool: 'meta' }),
    write('folders.create', 'Make a folder for one type of thing (Personal, or Space when the person may share)', { ...V, idem: 'key', in: { type: resourceType, name: t.str(), parentId: t.opt(id.folder), scope: t.opt(t.enm('personal', 'space')) }, out: { folder: folderRow }, emits: ['folder.created', 'grant.created', 'access.changed'], tool: 'meta', offline: 'queue' }),
    write('folders.rename', 'Rename a folder', { in: { folderId: id.folder, name: t.str() }, out: { folder: folderRow }, on: ['folder', '/folderId'], level: 'manage', emits: ['folder.renamed'], tool: 'meta', offline: 'queue' }),
    write('folders.move', 'Move a folder under another folder, or to the top', { in: { folderId: id.folder, parentId: t.nullable(id.folder) }, out: { folder: folderRow }, on: ['folder', '/folderId'], level: 'manage', emits: ['folder.moved', 'item.moved', 'access.changed'], tool: 'meta', offline: 'queue' }),
    write('folders.delete', 'Delete a folder; its items go back to their owners', { in: { folderId: id.folder }, out: { deleted: t.bool() }, on: ['folder', '/folderId'], level: 'manage', emits: ['folder.deleted', 'item.moved', 'grant.revoked', 'access.changed'], gate: { act: 'delete', when: "actor.kind != 'person'" }, tool: 'meta', offline: 'queue' }),
    write('folders.place', 'Put an item in a folder; a shared folder shares it, nothing is copied', { ...V, in: { resource: resourceRef, folderId: id.folder }, out: ok, emits: ['item.moved', 'access.changed'], tool: 'meta', offline: 'queue', errors: ['permission.not_contained'] }),
    write('folders.unplace', 'Take an item out of its folder back to the top of its section', { ...V, in: { resource: resourceRef }, out: ok, emits: ['item.moved', 'access.changed'], tool: 'meta', offline: 'queue' }),

    // ---- health
    read('access.projection_health', 'Health probe: access projections are current and the epoch is advancing', { ...V, out: { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()) } }),
  ],

  entities: [
    // DECISION: principal rows keep their own ids (usr_, agt_, act_, svc_); the idPrefix prn_ names the projection.
    entity('principal', 'access_principals', 'prn_', { name: 'text', kind: 'choice', owner: 'text', status: 'choice', roles: 'text', groups: 'text', title: 'text', createdAt: 'datetime' }, 'space', { sync: { protectedFields: ['status', 'roles'] }, fts: ['name', 'title'] }),
    entity('role', 'access_roles', 'rol_', { name: 'text', builtIn: 'checkbox', clearance: 'choice', assignableToAgents: 'checkbox', permissions: 'text' }, 'space', { sync: { protectedFields: ['permissions', 'clearance'] } }),
    entity('group', 'access_groups', 'grp_', { name: 'text', members: 'text', managers: 'text', builtIn: 'checkbox' }, 'space'),
    entity('grant', 'access_grants', 'gnt_', { subjectKind: 'choice', subjectId: 'text', resourceType: 'choice', resourceId: 'text', level: 'choice', conditions: 'text', expiresAt: 'datetime', by: 'text', source: 'text' }, 'space', { sync: { profile: { desktop: 'none', phone: 'none', web: 'none' }, protectedFields: ['level', 'subjectId', 'resourceId'] } }),
    entity('folder', 'access_folders', 'fld_', { resourceType: 'choice', name: 'text', parentId: 'text', scope: 'choice', owner: 'text', createdAt: 'datetime' }, 'folder', { parent: { entity: 'folder', field: 'parentId' }, parentField: 'parentId', ownerField: 'owner' }),
    entity('placement', 'access_placement', 'plc_', { resourceType: 'choice', resourceId: 'text', folderId: 'text' }, 'folder', { parentField: 'folderId' }),
    entity('my_access', 'access_my_access', 'acc_', { person: 'person', resourceType: 'choice', resourceId: 'text', level: 'choice', via: 'choice' }, 'space', { ownerField: 'person', sync: { profile: { desktop: 'all', phone: 'all', web: 'all' } } }),
  ],

  blocks: [
    block('access_request', { requestId: t.id('arq'), requester: id.user, resource: resourceRef, resourceTitle: t.str(), level, note: t.opt(t.str()), state: t.enm('waiting', 'granted', 'declined') },
      'Access request: {{requester}} asks for {{level}} on {{resourceTitle}}. {{note}}', {
        actions: [
          { key: 'approve', label: 'Approve', cap: 'access.requests.approve', input: { requestId: '/requestId', level: '/level' } },
          { key: 'decline', label: 'Decline', cap: 'access.requests.decline', input: { requestId: '/requestId' } },
        ],
      }),
  ],

  screens: [
    screen('access.people', 'console', 'ui:ConsolePeople', { needs: ['console.access'], q: { people: ['access.principals.list', { q: '/state/query', kind: '/state/kind', status: '/state/status' }] }, a: { assign_role: ['access.roles.assign', { subject: '/state/subject', roleId: '/state/roleId' }] }, empty: 'No people yet. Invite someone', primary: 'Invite' }),
    screen('access.roles', 'console', 'ui:ConsoleRolesMatrix', { needs: ['console.access'], q: { roles: ['access.roles.list'] }, a: { preview: ['access.roles.preview', { roleId: '/state/roleId', permissions: '/state/permissions' }], apply: ['access.roles.apply', { roleId: '/state/roleId', permissions: '/state/permissions', previewHash: '/state/previewHash' }, 'Apply this change to every holder?'], clone: ['access.roles.create', { name: '/state/name', cloneFrom: '/state/cloneFrom' }] } }),
    screen('access.groups', 'console', 'ui:ConsoleGroups', { needs: ['console.access'], q: { groups: ['access.groups.list', { q: '/state/query' }] }, a: { create: ['access.groups.create', { name: '/state/name' }], add_member: ['access.groups.add_member', { groupId: '/state/groupId', member: '/state/member' }] }, empty: 'No groups yet', primary: 'New group' }),
    screen('access.grants', 'console', 'ui:ConsoleGrants', { needs: ['console.access'], q: { grants: ['access.grants.list', { resource: '/state/resource', subject: '/state/subject' }] }, a: { revoke: ['access.unshare', { grantId: '/state/grantId' }, 'Remove this access?'] } }),
    screen('access.policies', 'console', 'ui:ConsolePolicies', { needs: ['policy.manage'], q: { policies: ['access.policies.list', { kind: '/state/kind' }] }, a: { set: ['access.policies.set', { key: '/state/key', scope: '/state/scope', value: '/state/value' }], reset: ['access.policies.reset', { key: '/state/key', scope: '/state/scope' }, 'Back to the default?'] } }),
    screen('access.checker', 'console', 'ui:ConsoleAccessChecker', { needs: ['access.manage'], a: { check: ['access.check', { principal: '/state/principal', action: '/state/action', resource: '/state/resource' }], view_as: ['access.view_as', { person: '/state/person' }] }, empty: 'Pick a person, an action and a resource' }),
    screen('access.reviews', 'console', 'ui:ConsoleAccessReviews', { needs: ['access.manage'], q: { reviews: ['access.reviews.list', { state: '/state/state' }] }, a: { start: ['access.reviews.start'], decide: ['access.reviews.decide', { reviewId: '/state/reviewId', grantId: '/state/grantId', decision: '/state/decision' }] }, empty: 'No reviews yet', primary: 'Start a review' }),
    screen('access.share_sheet', 'shell', 'ui:ShareSheet', { slot: 'sheet', q: { shares: ['access.shares_of', { resource: '/state/resource' }] }, a: { share: ['access.share', { resource: '/state/resource', subject: '/state/subject', level: '/state/level' }], unshare: ['access.unshare', { grantId: '/state/grantId' }], request: ['access.request', { resource: '/state/resource', level: '/state/level', note: '/state/note' }] }, empty: 'Only you have access' }),
  ],

  health: [
    health('access.projection', 'Access projections', 'access.projection_health', 'Restart the server from Console > Server; if it stays red, open the support bundle'),
  ],

  settings: [
    setting('access.review_every_days', 'space', 'console.access', 'Run an access review every', t.int({ minimum: 7, maximum: 365 }), 90),
    setting('sharing.public_links', 'space', 'console.access', 'Who may make public read-only links', t.enm('off', 'admins', 'members'), 'admins', { floorable: true }),
  ],
});
