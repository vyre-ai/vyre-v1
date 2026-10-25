// notifications (lane L6): three levels, nothing to set up (spec 2.24, 4.10). Owns every NotificationKindDef, the notification entity,
// away and delegate, mute, push registration and the digest collector. The async consumer `notifications.fanout` turns events into rows.
// DECISION: kind level and place follow spec 2.24. Needs you lives in Chats, so approvals and agent blocks target place 'chats'.
// DECISION: the agent interrupt cap (3 per person per hour, the rest go to the digest and the agent is told) is enforced in notifications.send
// through agentRateKey; the capability rate limit below only guards against floods.
// DECISION: notifications.send is declared outward with an explicit no-act gate: a push carries no content and is not an act of speech.
import { defineManifest, entity, ev, notif, outward, read, screen, setting, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut, resourceRef } from './_common.ts';

const level = t.enm('interrupt', 'badge', 'digest');
const place = t.enm('home', 'chats', 'inbox', 'records', 'files', 'apps', 'automations', 'vault', 'settings', 'console');
const kindKey = t.enm(
  'approval.requested', 'approval.backstop', 'dm', 'mention', 'call.incoming', 'agent.blocked', 'incident.owned', 'task.assigned', 'reply.followed',
  'agent.task_finished', 'campaign.reply', 'digest.away', 'mention.thread', 'run.failed', 'conflict.needs_you', 'access.requested', 'access.decided',
  'sync.attention', 'health.degraded', 'problem.report', 'member.joined', 'limit.hit', 'vault.rotation_due',
);
const notificationRow = t.obj({
  id: id.notification, kind: kindKey, level, place, title: t.str(), body: t.opt(t.str()), subject: t.opt(resourceRef), count: t.int({ minimum: 1 }),
  at: t.ts(), seenAt: t.opt(t.ts()), actions: t.arr(t.obj({ label: t.str(), cap: t.str() })), spaceId: id.space,
});
const hours = t.obj({
  days: t.arr(t.int({ minimum: 0, maximum: 6 }), { description: '0 is Sunday' }), from: t.str({ pattern: '^[0-2][0-9]:[0-5][0-9]$', examples: ['09:00'] }),
  to: t.str({ pattern: '^[0-2][0-9]:[0-5][0-9]$', examples: ['18:00'] }), tz: t.str({ examples: ['Asia/Karachi'] }),
});
const rules = t.obj({
  workingHours: t.opt(hours), emailBackstop: t.bool(), mutedAgents: t.arr(id.agent), mutedChannels: t.arr(id.channel), mutedRecords: t.arr(id.record),
});
const channel = t.enm('desktop', 'phone', 'email');
const delegateTo = t.obj({ kind: t.enm('person', 'role', 'none'), id: t.opt(t.str({ examples: ['usr_a1b2c3'] })) });
const mutable = t.obj({ kind: t.enm('person', 'agent', 'channel', 'record', 'thread'), id: t.str({ examples: ['agt_a1b2c3'] }) });

export default defineManifest({
  id: 'notifications',
  title: 'Notifications',
  owner: 'L6',
  entities: [
    entity('notification', 'notifications_items', 'ntf_', {
      person: 'person', kind: 'choice', level: 'choice', place: 'choice', title: 'text', body: 'text', subject_type: 'text', subject_id: 'text',
      collapse_key: 'text', count: 'number', at: 'datetime', seen_at: 'datetime', actions: 'text', run_id: 'text', trace_id: 'text',
    }, 'space', { ownerField: 'person', sync: { profile: { desktop: 'all', phone: 'window', web: 'window' }, window: { days: 30, recentCount: 200 } } }),
  ],
  notificationKinds: [
    notif('approval.requested', 'interrupt', 'chats', 'Approval needed: {{title}}', {
      pushTitle: '{{space}} needs you', actions: [{ label: 'Approve', cap: 'tasks.act' }, { label: 'Send back', cap: 'tasks.act' }], agentRateKey: 'agent_interrupt', backstopEmailAfterHours: 4,
    }),
    notif('approval.backstop', 'interrupt', 'chats', 'Still waiting on you: {{title}}', { pushTitle: '{{space}} needs you', actions: [{ label: 'Open', cap: 'tasks.act' }], respectHours: false }),
    notif('dm', 'interrupt', 'chats', 'Message from {{from}}', { pushTitle: '{{space}} needs you', agentRateKey: 'agent_interrupt', actions: [{ label: 'Reply', cap: 'chat.post' }] }),
    notif('mention', 'interrupt', 'chats', '{{from}} mentioned you in {{where}}', { pushTitle: '{{space}} needs you', agentRateKey: 'agent_interrupt', actions: [{ label: 'Reply', cap: 'chat.post' }] }),
    notif('call.incoming', 'interrupt', 'inbox', 'Incoming call from {{from}}', { pushTitle: '{{space}} is calling', respectHours: false }),
    notif('agent.blocked', 'interrupt', 'chats', '{{agent}} is blocked: {{reason}}', { pushTitle: '{{space}} needs you', agentRateKey: 'agent_interrupt', actions: [{ label: 'Unblock', cap: 'tasks.act' }] }),
    notif('incident.owned', 'interrupt', 'console', 'Incident you own: {{title}}', { pushTitle: '{{space}} needs you', respectHours: false }),
    notif('task.assigned', 'badge', 'home', '{{from}} gave you a task: {{title}}', { actions: [{ label: 'Start', cap: 'tasks.transition' }] }),
    notif('reply.followed', 'badge', 'inbox', 'New reply on {{where}}'),
    notif('agent.task_finished', 'badge', 'chats', '{{agent}} finished: {{title}}', { agentRateKey: 'agent_interrupt' }),
    notif('campaign.reply', 'badge', 'apps', 'Reply from {{from}} to {{campaign}}'),
    notif('digest.away', 'digest', 'home', 'While you were away'),
    notif('mention.thread', 'badge', 'chats', 'Mentioned in a thread: {{where}}', { actions: [{ label: 'Reply', cap: 'chat.post' }] }),
    notif('run.failed', 'badge', 'automations', '{{name}} failed: {{message}}', { actions: [{ label: 'Retry', cap: 'runs.retry' }] }),
    notif('conflict.needs_you', 'badge', 'records', 'Two edits conflict on {{title}}', { actions: [{ label: 'Resolve', cap: 'tasks.act' }] }),
    notif('access.requested', 'badge', 'console', '{{from}} asks for {{level}} access to {{title}}', { actions: [{ label: 'Review', cap: 'tasks.act' }] }),
    notif('access.decided', 'badge', 'home', 'Your access request for {{title}} was {{decision}}'),
    notif('sync.attention', 'badge', 'settings', 'Sync needs attention on {{device}}'),
    notif('health.degraded', 'badge', 'console', '{{service}} is {{state}}'),
    notif('problem.report', 'badge', 'console', 'Problem report from {{from}}', { actions: [{ label: 'Review', cap: 'tasks.act' }] }),
    notif('member.joined', 'digest', 'home', '{{name}} joined {{space}}'),
    notif('limit.hit', 'badge', 'chats', '{{title}} hit its limit', { actions: [{ label: 'Raise once', cap: 'tasks.act' }, { label: 'Stop', cap: 'tasks.act' }] }),
    notif('vault.rotation_due', 'badge', 'vault', 'Time to rotate {{title}}', { actions: [{ label: 'Mark rotated', cap: 'vault.item.mark_rotated' }] }),
  ],
  events: [
    ev('notification.delivered', 'A notification was delivered to a person at its level', {
      p: { notificationId: id.notification, person: t.str(), kind: kindKey, level, place, subject: t.opt(resourceRef), collapsed: t.bool(), pushed: t.bool(), device: t.opt(id.device) },
      subject: ['entity', '/notificationId'], vis: 'owner', replay: 'stub',
    }),
    ev('notification.seen', 'Notifications were marked seen', { p: { person: t.str(), notificationIds: t.arr(id.notification), place: t.opt(place) }, subject: ['entity', '/person'], vis: 'owner' }),
    ev('notification.capped', 'An agent hit the interrupt cap; the notification went to the digest and the agent was told', { p: { person: t.str(), agentId: id.agent, kind: kindKey, perHour: t.int() }, subject: ['entity', '/person'], vis: 'owner' }),
    ev('notification.muted', 'A sender, channel or record was muted for a time', { p: { person: t.str(), target: mutable, until: t.ts() }, subject: ['entity', '/person'], vis: 'owner' }),
    ev('notification.unmuted', 'A mute ended or was cleared', { p: { person: t.str(), target: mutable }, subject: ['entity', '/person'], vis: 'owner' }),
    ev('notification.rules_changed', 'Notification settings changed (hours, backstop, mutes)', { p: { person: t.str(), fields: t.arr(t.str()) }, subject: ['entity', '/person'], vis: 'owner' }),
    ev('away.set', 'A person set themselves away until a time with an approvals delegate', { p: { person: t.str(), until: t.ts(), delegate: delegateTo }, subject: ['entity', '/person'] }),
    ev('away.cleared', 'A person is back; what waited is summarised', { p: { person: t.str(), waitedApprovals: t.int(), waitedDigest: t.int() }, subject: ['entity', '/person'] }),
    ev('notification.push_registered', 'A device registered a push token (token value not in the event)', { p: { person: t.str(), device: id.device, platform: t.enm('ios', 'android', 'mac', 'windows', 'web') }, subject: ['entity', '/device'], vis: 'owner' }),
    ev('notification.delegate_changed', 'A standing approvals delegate chain changed', { p: { person: t.str(), chain: t.arr(delegateTo) }, subject: ['entity', '/person'], vis: 'owner' }),
  ],
  capabilities: [
    outward('notifications.send', 'Notify a person of a kind; collapses repeats, respects hours, mutes and away, enforces the agent interrupt cap and the one-device rule', {
      in: { to: t.str({ examples: ['usr_a1b2c3'] }), kind: kindKey, subject: t.opt(resourceRef), data: t.opt(t.rec()), title: t.opt(t.str()), body: t.opt(t.str()), collapseKey: t.opt(t.str()), runId: t.opt(id.run) },
      out: { outcome: t.enm('interrupt', 'badge', 'digest', 'dropped_muted', 'capped'), notificationId: t.opt(id.notification) },
      gate: { act: 'none', reason: 'A push carries no content, only the Space name, and is rate limited; it is not an act of speech' },
      emits: ['notification.delivered', 'notification.capped'], rate: { n: 120, perSeconds: 60, scope: 'principal' }, idem: 'natural', audit: 'none', level: 'use', tool: 'meta',
      errors: ['rate_limit.exceeded'],
    }),
    read('notifications.list', 'My notifications by place and level, newest first', {
      in: { place: t.opt(place), level: t.opt(level), unseenOnly: t.opt(t.bool()), ...pageIn }, out: { notifications: t.arr(notificationRow), ...pageOut }, tool: 'meta', label: 'filter',
    }),
    read('notifications.counts', 'Counts for the rail (Needs you and direct conversations only) and a quiet dot per other place', {
      in: {}, out: { rail: t.obj({ needsYou: t.int(), directConversations: t.int() }), dots: t.rec(t.int()), otherSpaces: t.arr(t.obj({ spaceId: id.space, needsYou: t.int() })) }, tool: 'meta',
    }),
    write('notifications.mark_seen', 'Mark notifications seen by ids or for a whole place', {
      in: { notificationIds: t.opt(t.arr(id.notification)), place: t.opt(place) }, out: { marked: t.int() }, emits: ['notification.seen'], tool: 'meta', offline: 'queue',
    }),
    read('notifications.kinds.list', 'The notification kinds with level and place, for the settings page', {
      in: {}, out: { kinds: t.arr(t.obj({ key: kindKey, level, place, title: t.str(), respectHours: t.bool(), mine: t.opt(t.obj({ level, channels: t.arr(channel) })) })) }, tool: 'meta',
    }),
    write('notifications.kind.set_level', 'Set how one kind of notification reaches me: its level and which of desktop, phone and email carry it. Give a level, channels, or both; channels alone pick the level (desktop or phone interrupt, otherwise badge). Approval reminders and owned incidents never go below Interrupt', {
      in: { kind: kindKey, level: t.opt(level), channels: t.opt(t.arr(channel, { maxItems: 3 })) },
      out: { kind: kindKey, level, channels: t.arr(channel) }, level: 'use', emits: ['notification.rules_changed'], tool: 'meta', offline: 'queue',
      errors: ['validation.bad_input', 'validation.precondition_failed'],
    }),
    read('notifications.rules.get', 'My notification settings: working hours, email backstop, muted agents, channels and records', { in: {}, out: { rules }, tool: 'meta' }),
    write('notifications.rules.set', 'Adjust my notification settings (settings only adjusts; nothing is required)', {
      in: { workingHours: t.opt(t.nullable(hours)), emailBackstop: t.opt(t.bool()), mutedAgents: t.opt(t.arr(id.agent)), mutedChannels: t.opt(t.arr(id.channel)), mutedRecords: t.opt(t.arr(id.record)) },
      out: { rules }, level: 'use', emits: ['notification.rules_changed'], tool: 'meta',
    }),
    write('notifications.mute.set', 'Mute a sender, channel, record or thread (default one hour)', {
      in: { target: mutable, minutes: t.opt(t.int({ minimum: 1, maximum: 525600 })) }, out: { until: t.ts() }, level: 'use', emits: ['notification.muted'], tool: 'meta', offline: 'queue',
    }),
    write('notifications.mute.clear', 'End a mute', { in: { target: mutable }, out: { cleared: t.bool() }, level: 'use', emits: ['notification.unmuted'], tool: 'meta' }),
    read('notifications.mute.list', 'My active mutes', { in: {}, out: { mutes: t.arr(t.obj({ target: mutable, until: t.ts() })) }, tool: 'meta' }),
    write('notifications.away.set', 'Set myself away until a time; approvals go to a person, a role or no one; only calls interrupt', {
      in: { until: t.ts(), delegate: delegateTo }, out: { until: t.ts() }, level: 'use', emits: ['away.set'], tool: 'meta', offline: 'queue', cli: 'vyre away set',
    }),
    write('notifications.away.clear', "I'm Back: end away and return what waited", {
      in: {}, out: { waitedApprovals: t.int(), waitedDigest: t.int(), digestId: t.opt(t.id('dgs')) }, level: 'use', emits: ['away.cleared'], tool: 'meta', cli: 'vyre away clear',
    }),
    read('notifications.away.get', 'Am I away, until when, and who holds my approvals', { in: {}, out: { away: t.bool(), until: t.opt(t.ts()), delegate: t.opt(delegateTo) }, tool: 'meta' }),
    read('notifications.delegate.get', 'My standing approvals delegate chain (delegate, next delegate, role)', { in: {}, out: { chain: t.arr(delegateTo) }, tool: 'meta' }),
    write('notifications.delegate.set', 'Set my standing approvals delegate chain; a delegate never gains access', {
      in: { chain: t.arr(delegateTo, { maxItems: 5 }) }, out: { chain: t.arr(delegateTo) }, level: 'use', emits: ['notification.delegate_changed'], tool: 'meta',
    }),
    read('notifications.delegate.resolve', "Walk a person's delegate chain for an item and return the first holder who can act on it (access evaluated for each)", {
      in: { person: t.str(), resource: resourceRef }, out: { delegate: t.opt(t.obj({ kind: t.enm('person', 'role'), id: t.str() })), walked: t.int() },
    }),
    write('notifications.push.register', 'Register this device push token for the person', {
      in: { device: id.device, platform: t.enm('ios', 'android', 'mac', 'windows', 'web'), token: t.str({ minLength: 1 }) }, out: { registered: t.bool() },
      level: 'use', emits: ['notification.push_registered'], audit: 'none', offline: 'online', tool: 'meta',
    }),
    write('notifications.push.unregister', 'Remove this device push token', { in: { device: id.device }, out: { removed: t.bool() }, level: 'use', tool: 'meta', offline: 'online' }),
    read('notifications.digest.collect', 'Gather digest-level items for a person and period (input to the While you were away digest)', {
      in: { person: t.str(), since: t.ts(), until: t.opt(t.ts()) },
      out: { items: t.arr(t.obj({ kind: kindKey, title: t.str(), at: t.ts(), subject: t.opt(resourceRef), count: t.int() })) },
    }),
  ],
  settings: [
    setting('notifications.working_hours', 'person', 'Notifications', 'Working hours (outside them only calls, urgent approvals and incidents interrupt)', hours, { days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00', tz: 'UTC' }),
    setting('notifications.email_backstop', 'person', 'Notifications', 'Email me once if an approval waits 4 hours', t.bool(), true),
    setting('notifications.alert_replies', 'person', 'Notifications', 'Alert me on replies', t.bool(), false),
    setting('notifications.routines_all', 'person', 'Notifications', 'Also tell me when routines succeed (failures always)', t.bool(), false),
    setting('notifications.hand_needs_you_to', 'person', 'Notifications', 'While you are away, hand Needs you to (a person; none leaves it with you)', t.nullable(t.str({ examples: ['usr_a1b2c3'] })), null),
    setting('notifications.quiet_hours', 'person', 'Notifications', 'Quiet hours: no sounds or pushes between the two times; Needs you may come through', t.obj({
      on: t.bool(), from: t.str({ pattern: '^[0-2][0-9]:[0-5][0-9]$', examples: ['22:00'] }), to: t.str({ pattern: '^[0-2][0-9]:[0-5][0-9]$', examples: ['07:00'] }), needs: t.bool(),
    }), { on: false, from: '22:00', to: '07:00', needs: true }),
    setting('notifications.push_idle_minutes', 'space', 'Notifications', 'Minutes idle on the computer before pushes go to the phone', t.int({ minimum: 1, maximum: 60 }), 5),
  ],
  screens: [
    screen('notifications.banner', 'shell', 'ui:NotificationBanner', {
      slot: 'popover', q: { counts: ['notifications.counts', {}, true], list: ['notifications.list', { place: '/state/place', unseenOnly: '/state/unseenOnly' }, true] },
      a: { seen: ['notifications.mark_seen', { notificationIds: '/state/ids', place: '/state/place' }], mute: ['notifications.mute.set', { target: '/state/target', minutes: '/state/minutes' }] },
      empty: 'Nothing new',
    }),
    screen('notifications.away', 'shell', 'ui:AwaySheet', {
      slot: 'sheet', q: { away: ['notifications.away.get', {}, true], delegate: ['notifications.delegate.get', {}, true] },
      a: { set: ['notifications.away.set', { until: '/draft/until', delegate: '/draft/delegate' }], back: ['notifications.away.clear', {}] },
      empty: 'You are not away',
    }),
    screen('notifications.settings', 'settings', 'ui:NotificationSettings', {
      q: { rules: ['notifications.rules.get', {}, true], mutes: ['notifications.mute.list', {}, true], kinds: ['notifications.kinds.list', {}, false] },
      a: { set: ['notifications.rules.set', { workingHours: '/draft/workingHours', emailBackstop: '/draft/emailBackstop', mutedAgents: '/draft/mutedAgents', mutedChannels: '/draft/mutedChannels', mutedRecords: '/draft/mutedRecords' }], unmute: ['notifications.mute.clear', { target: '/state/target' }] },
      empty: 'No mutes',
    }),
  ],
});
