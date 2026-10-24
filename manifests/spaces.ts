// spaces (lane L7a): Space profile, switcher data, stars and follows, onboarding checklist, the Personal versus Team matrix,
// export zip, leave, transfer, delete and the address (relay or own domain) switch.
// DECISION: the server knows only its own Space; spaces.switcher returns this Space's tile (name, logo, needs-you dot) and the client assembles the list from each Space session. No list of a person's Spaces is kept by us.
// DECISION: the skin default and the allowed AI accounts policy are settings rows written through settings.set; the profile fields are written by spaces.update.
// DECISION: skin keys are plain strings because the 13 skins live in the UI token set, not in a manifest.
import { defineManifest, entity, ev, read, screen, setting, t, write } from '../packages/contracts/src/index.ts';
import { id, ok, resourceRef, resourceType } from './_common.ts';

const V = { level: 'view' } as const;
const spaceRow = t.obj({
  id: id.space, name: t.str(), legalName: t.opt(t.str()), logoFileId: t.opt(id.file), kind: t.enm('personal', 'team'), owner: id.user,
  fingerprint: t.str({ examples: ['ab12 cd34 ef56 7890'] }), address: t.obj({ mode: t.enm('relay', 'own_domain', 'device'), host: t.opt(t.str()) }), hostedOn: t.opt(t.str()),
  defaults: t.rec(), createdAt: t.ts(),
});
const stepKey = t.enm('photo_title', 'connect_mailbox', 'meet_assistant', 'first_project', 'import');
const featureKey = t.enm('apps_public', 'campaign_sending', 'console', 'agent_computers', 'webhooks', 'always_on_runs', 'sharing', 'members');

export default defineManifest({
  id: 'spaces',
  title: 'Spaces',
  owner: 'L7a',

  events: [
    ev('space.updated', 'The Space profile changed (name, legal name, logo, defaults)', { p: { fields: t.arr(t.str()), by: t.str() }, subject: ['entity', '/by'], trigger: { title: 'The Space profile changes' }, retention: 'audit' }),
    ev('space.address_changed', 'The Space address moved between relay and an own domain; devices keep the pinned Space key', { p: { mode: t.enm('relay', 'own_domain'), host: t.opt(t.str()), by: t.str() }, subject: ['entity', '/mode'], retention: 'audit' }),
    ev('space.ownership_transferred', 'Ownership moved to another person', { p: { from: id.user, to: id.user }, subject: ['entity', '/to'], retention: 'audit' }),
    ev('space.deleted', 'The Space was deleted by its owner', { p: { by: id.user }, subject: ['entity', '/by'], retention: 'audit' }),
    ev('star.added', 'Something was starred', { p: { person: id.user, resource: resourceRef }, subject: ['entity', '/resource/id'], vis: 'owner' }),
    ev('star.removed', 'A star was removed', { p: { person: id.user, resource: resourceRef }, subject: ['entity', '/resource/id'], vis: 'owner' }),
    ev('follow.added', 'Something was followed', { p: { person: id.user, resource: resourceRef }, subject: ['entity', '/resource/id'], vis: 'owner' }),
    ev('follow.removed', 'A follow was removed', { p: { person: id.user, resource: resourceRef }, subject: ['entity', '/resource/id'], vis: 'owner' }),
    ev('onboarding.step_completed', 'A first-run checklist step was done', { p: { person: id.user, step: stepKey }, subject: ['entity', '/person'], vis: 'owner' }),
    ev('onboarding.dismissed', 'The first-run checklist was dismissed', { p: { person: id.user }, subject: ['entity', '/person'], vis: 'owner' }),
  ],

  capabilities: [
    read('spaces.get', 'The Space profile (regen proof): name, legal name, logo, address, hosting, defaults, kind', { ...V, in: {}, out: { space: spaceRow }, tool: 'meta' }),
    write('spaces.update', 'Change the Space name, legal name, logo or defaults', {
      ...V, in: { name: t.opt(t.str()), legalName: t.opt(t.str()), logoFileId: t.nullable(id.file), defaults: t.opt(t.rec()) }, out: { space: spaceRow }, perm: 'policy.manage', emits: ['space.updated'], audit: 'always', tool: 'meta',
    }),
    read('spaces.switcher', 'This Space tile for the switcher: name, logo, kind, role, and whether it needs the person (red dot)', {
      ...V, in: {}, out: { name: t.str(), logoFileId: t.opt(id.file), kind: t.enm('personal', 'team'), role: t.str(), needsYou: t.int({ minimum: 0 }), unread: t.int({ minimum: 0 }) }, tool: 'meta',
    }),
    read('spaces.matrix', 'Which features work in this Space and which need a Team Space (the Personal matrix)', {
      ...V, in: {}, out: { kind: t.enm('personal', 'team'), features: t.arr(t.obj({ key: featureKey, available: t.bool(), line: t.opt(t.str({ examples: ['Needs a Team Space'] })) })) }, tool: 'meta',
    }),

    // ---- stars and follows (independent toggles)
    write('stars.toggle', 'Star or unstar anything; starring a person or company offers Also follow', {
      ...V, in: { resource: resourceRef, on: t.bool(), alsoFollow: t.opt(t.bool()) }, out: { starred: t.bool(), following: t.bool() }, emits: ['star.added', 'star.removed', 'follow.added'], tool: 'meta', offline: 'queue',
    }),
    read('stars.list', 'My starred things, newest first', { ...V, in: { type: t.opt(resourceType) }, out: { stars: t.arr(t.obj({ resource: resourceRef, title: t.str(), at: t.ts() })) }, tool: 'meta' }),
    write('follows.toggle', 'Follow or unfollow something so its updates reach my Inbox', {
      ...V, in: { resource: resourceRef, on: t.bool() }, out: { following: t.bool() }, emits: ['follow.added', 'follow.removed'], tool: 'meta', offline: 'queue',
    }),
    read('follows.list', 'What I follow', { ...V, in: { type: t.opt(resourceType) }, out: { follows: t.arr(t.obj({ resource: resourceRef, title: t.str(), at: t.ts() })) }, tool: 'meta' }),

    // ---- onboarding checklist
    read('spaces.onboarding.get', 'The first-run checklist for me: steps done, steps left', {
      ...V, in: {}, out: { dismissed: t.bool(), steps: t.arr(t.obj({ key: stepKey, title: t.str(), done: t.bool() })) }, tool: 'meta',
    }),
    write('spaces.onboarding.complete', 'Mark a checklist step done (steps also complete themselves when the event happens)', { ...V, in: { step: stepKey }, out: ok, emits: ['onboarding.step_completed'], tool: 'meta', offline: 'queue' }),
    write('spaces.onboarding.dismiss', 'Hide the checklist', { ...V, in: {}, out: ok, emits: ['onboarding.dismissed'], tool: 'meta', offline: 'queue' }),

    // ---- export, leave, transfer, delete, address
    write('spaces.export', 'Owner one-click export: a zip of records, files, chats and settings; never secret values, never others\' private chats or personal memory', {
      ...V, level: 'manage', idem: 'key', in: {}, out: { runId: id.run }, perm: 'records.export', audit: 'always', risk: 'high', run: { kind: 'space_export', stoppable: true }, tool: 'meta',
    }),
    write('spaces.leave', 'Leave this Space; the local folder is wiped and the server stops serving this person (the owner must transfer first)', {
      ...V, in: { confirm: t.lit(true) }, out: ok, emits: ['member.removed', 'principal.suspended'], audit: 'always', offline: 'online', tool: 'meta', errors: ['validation.precondition_failed'],
    }),
    write('spaces.transfer_ownership', 'Owner only: hand the Space to another person', {
      level: 'manage', in: { to: id.user }, out: ok, emits: ['space.ownership_transferred', 'access.changed'], audit: 'always', risk: 'high', tool: 'meta', team: true,
    }),
    write('spaces.delete', 'Owner only: delete the Space after typing its legal name', {
      level: 'manage', in: { confirmName: t.str() }, out: ok, emits: ['space.deleted'], gate: { act: 'delete', when: "actor.kind != 'person'" }, audit: 'always', risk: 'high', tool: 'meta', errors: ['validation.precondition_failed'],
    }),
    write('spaces.switch_address', 'Move the Space between the relay and an own domain; devices pin the Space key, so nobody is re-invited', {
      ...V, in: { mode: t.enm('relay', 'own_domain'), host: t.opt(t.str({ examples: ['team.example.com'] })) }, out: { space: spaceRow }, perm: 'server.network', emits: ['space.address_changed'], audit: 'always', risk: 'high', tool: 'engineer', team: true,
    }),
  ],

  entities: [
    entity('star', 'spaces_star', 'str_', { person: 'person', resourceType: 'choice', resourceId: 'text', createdAt: 'datetime' }, 'space', { ownerField: 'person', sync: { profile: { desktop: 'all', phone: 'all', web: 'all' } } }),
    entity('follow', 'spaces_follow', 'flw_', { person: 'person', resourceType: 'choice', resourceId: 'text', createdAt: 'datetime' }, 'space', { ownerField: 'person', sync: { profile: { desktop: 'all', phone: 'all', web: 'all' } } }),
  ],

  screens: [
    screen('spaces.console', 'console', 'ui:ConsoleSpace', {
      needs: ['console.access'], q: { space: ['spaces.get'] },
      a: { update: ['spaces.update', { name: '/state/name', legalName: '/state/legalName', logoFileId: '/state/logoFileId', defaults: '/state/defaults' }], export: ['spaces.export'], transfer: ['spaces.transfer_ownership', { to: '/state/to' }, 'Hand the Space over?'], delete: ['spaces.delete', { confirmName: '/state/confirmName' }, 'Delete the Space for everyone?'], address: ['spaces.switch_address', { mode: '/state/mode', host: '/state/host' }] },
    }),
    screen('spaces.settings_index', 'settings', 'ui:SettingsSpaces', { q: { tile: ['spaces.switcher'], space: ['spaces.get'] }, a: { leave: ['spaces.leave', { confirm: '/state/confirm' }, 'Leave this Space and wipe its local copy?'] } }),
    screen('spaces.onboarding', 'home', 'ui:OnboardingChecklist', { q: { checklist: ['spaces.onboarding.get'] }, a: { done: ['spaces.onboarding.complete', { step: '/state/step' }], dismiss: ['spaces.onboarding.dismiss'] }, empty: 'You are all set' }),
    screen('spaces.switcher', 'shell', 'ui:SpaceSwitcher', { slot: 'popover', q: { tile: ['spaces.switcher'] } }),
    screen('spaces.needs_team', 'shell', 'ui:NeedsTeamSpace', { q: { matrix: ['spaces.matrix'] }, empty: 'Needs a Team Space', primary: 'Create or join a Team Space' }),
  ],

  settings: [
    setting('space.allowed_ai_accounts', 'space', 'console.space', 'Allowed AI accounts', t.enm('any', 'company'), 'any', { floorable: true }),
    setting('space.skin_default', 'space', 'console.space', 'Default skin', t.str(), 'classic'),
    setting('space.data_location', 'space', 'console.space', 'Data location', t.str({ examples: ['EU'] }), 'where the Space server runs'),
  ],
});
