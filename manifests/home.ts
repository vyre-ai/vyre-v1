// home (lane L6): aggregate reads for the Home place (spec 3.1, architecture 7.1). Needs you and My work come from `tasks`,
// Today from `calendar`, Starred from `spaces`; this module owns the digest entity, Projects at risk, today's routines and the first-run checklist.
// DECISION (spec Appendix B, b2, Provisional): the digest is three lines on top, then at most seven items, written by the person's assistant on a schedule
// through home.write_digest; it resets once seen. "See all" opens home.activity.
// DECISION: the Ask box on Home is a plain composer owned by the chats module, so this module declares no screen for it.
// DECISION: Projects at risk rule = overdue, blocked or slipped; the rule text is returned by home.at_risk so the section menu can show it.
import { defineManifest, entity, ev, read, screen, setting, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut, resourceRef } from './_common.ts';

const itemKind = t.enm('decision', 'finished', 'record_change', 'routine', 'waiting');
const digestItem = t.obj({
  kind: itemKind, title: t.str(), line: t.str(), subject: t.opt(resourceRef), at: t.opt(t.ts()),
  undo: t.opt(t.obj({ cap: t.str({ examples: ['runs.undo'] }), input: t.json() })),
});
const digestId = t.id('dgs');
const digestRow = t.obj({
  id: digestId, person: t.str({ examples: ['usr_a1b2c3'] }), periodStart: t.ts(), periodEnd: t.ts(),
  headline: t.arr(t.str(), { maxItems: 3, description: 'Three lines on top' }), items: t.arr(digestItem, { maxItems: 7 }),
  seenAt: t.opt(t.ts()), builtBy: t.str({ description: 'The assistant that wrote it' }),
});
const reason = t.enm('overdue', 'blocked', 'slipped');
const checklistItem = t.enm('photo_and_title', 'connect_mailbox_and_calendar', 'meet_assistant', 'open_first_project', 'import');

export default defineManifest({
  id: 'home',
  title: 'Home',
  owner: 'L6',
  entities: [
    entity('digest', 'home_digests', 'dgs_', {
      person: 'person', period_start: 'datetime', period_end: 'datetime', headline: 'text', items: 'text', seen_at: 'datetime', built_by: 'text',
    }, 'space', { ownerField: 'person', sync: { profile: { desktop: 'all', phone: 'all', web: 'all' }, window: { days: 14, recentCount: 20 } } }),
  ],
  events: [
    ev('digest.written', 'The While you were away digest was written for a person', { p: { digestId, person: t.str(), periodStart: t.ts(), periodEnd: t.ts(), items: t.int() }, subject: ['entity', '/digestId'], vis: 'owner', notify: 'digest.away' }),
    ev('digest.seen', 'A person saw their digest; it resets', { p: { digestId, person: t.str() }, subject: ['entity', '/digestId'], vis: 'owner' }),
    ev('checklist.dismissed', 'The first-run checklist was dismissed or finished', { p: { person: t.str(), reason: t.enm('done', 'dismissed') }, subject: ['entity', '/person'], vis: 'owner' }),
  ],
  capabilities: [
    read('home.digest', 'My While you were away digest: three lines, then at most seven ranked items, each decision with Undo', {
      in: {}, out: { digest: t.nullable(digestRow) }, tool: 'meta', cli: 'vyre home digest',
    }),
    write('home.write_digest', 'Store a digest the assistant wrote for a person (scheduled)', {
      in: { person: t.str(), periodStart: t.ts(), periodEnd: t.ts(), headline: t.arr(t.str(), { maxItems: 3 }), items: t.arr(digestItem, { maxItems: 7 }), builtBy: t.str() },
      out: { digestId }, level: 'use', emits: ['digest.written'], idem: 'key',
    }),
    write('home.mark_digest_seen', 'Mark the digest seen so it resets', { in: { digestId }, out: { ok: t.bool() }, level: 'use', emits: ['digest.seen'], tool: 'meta', offline: 'queue' }),
    read('home.activity', 'See all: the full activity for the digest period on records I follow, my agents, and my routines', {
      in: { since: t.ts(), until: t.opt(t.ts()), kinds: t.opt(t.arr(itemKind)), ...pageIn }, out: { items: t.arr(digestItem), ...pageOut }, tool: 'meta', label: 'filter',
    }),
    read('home.at_risk', 'Projects at risk: overdue, blocked or slipped, with the counting rule', {
      in: { limit: t.opt(t.int({ minimum: 1, maximum: 100 })) },
      out: {
        rule: t.str({ examples: ['A project is at risk when it is overdue, has a blocked task, or its plan has slipped past a milestone'] }),
        projects: t.arr(t.obj({ recordId: id.record, type: id.recordType, title: t.str(), reasons: t.arr(reason), dueAt: t.opt(t.ts()), lead: t.opt(t.str()), blockedTasks: t.int(), overdueTasks: t.int() })),
      },
      tool: 'meta', label: 'filter',
    }),
    read("home.routines_today", "Today's routines of my agents: scheduled, running, done or failed, one line each", {
      in: {},
      out: { routines: t.arr(t.obj({ agentId: id.agent, routineId: t.str(), title: t.str(), at: t.ts(), state: t.enm('scheduled', 'running', 'done', 'failed'), runId: t.opt(id.run), resultLine: t.opt(t.str()) })) },
      tool: 'meta', label: 'filter',
    }),
    read('home.checklist', 'The first-run checklist: five items, hidden once all are done or dismissed', {
      in: {}, out: { visible: t.bool(), items: t.arr(t.obj({ key: checklistItem, title: t.str(), done: t.bool() })) }, tool: 'meta',
    }),
    write('home.dismiss_checklist', 'Dismiss the first-run checklist', { in: {}, out: { ok: t.bool() }, level: 'use', emits: ['checklist.dismissed'], tool: 'meta', offline: 'queue' }),
  ],
  settings: [
    setting('home.digest_schedule', 'person', 'Home', 'When the assistant writes the While you were away digest', t.obj({ at: t.str({ pattern: '^[0-2][0-9]:[0-5][0-9]$', examples: ['07:30'] }), tz: t.str() }), { at: '07:30', tz: 'UTC' }),
  ],
  screens: [
    screen('home.needs-you-top3', 'home', 'ui:NeedsYouTop3', {
      q: { items: ['tasks.needs_you', { limit: '/state/limit' }, true] },
      a: { act: ['tasks.act', { taskId: '/state/taskId', action: '/state/action', note: '/state/note' }] },
      empty: 'Nothing needs you',
    }),
    screen('home.projects-at-risk', 'home', 'ui:ProjectsAtRisk', {
      q: { projects: ['home.at_risk', { limit: '/state/limit' }, true] }, empty: 'No projects at risk',
    }),
    screen('home.away-digest', 'home', 'ui:AwayDigest', {
      q: { digest: ['home.digest', {}, true], activity: ['home.activity', { since: '/state/since', until: '/state/until', kinds: '/state/kinds' }, false] },
      a: { seen: ['home.mark_digest_seen', { digestId: '/state/digestId' }], undo: ['runs.undo', { runId: '/state/runId' }, 'Undo what this run changed?'], back: ['notifications.away.clear', {}] },
      empty: 'Nothing happened while you were away',
    }),
    screen('home.routines-today', 'home', 'ui:RoutinesToday', {
      q: { routines: ['home.routines_today', {}, true] }, empty: 'No routines today',
    }),
    screen('home.checklist', 'home', 'ui:Checklist', {
      q: { checklist: ['home.checklist', {}, true] }, a: { dismiss: ['home.dismiss_checklist', {}] }, empty: 'All set',
    }),
  ],
});
