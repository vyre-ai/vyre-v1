// governance (lane L7a): retention jobs and the defaults for every kind of data (4.11, spec 2.26), holds, erase a person with tombstones.
// Owns ALL ten RetentionDefs; other modules point their events and entities at these keys.
// DECISION: the memory and records retention defaults are 'forever' (spec 2.26 lists them as configurable without a number); events and backups use words because their rule is not a single age.
// DECISION: records already have records.hold; governance.holds covers files, channels, threads, folders and people (a person hold blocks erasing and expiry of everything about them).
// DECISION: an erase finding expires after 24 hours; erasing under a hold needs overrideHold with a reason and the handler requires the Owner.
import { defineManifest, ev, health, read, retention, screen, setting, t, write } from '../packages/contracts/src/index.ts';
import { email, id, ok, pageIn, pageOut } from './_common.ts';

const V = { level: 'view' } as const;
const kind = t.enm('trash', 'run_logs', 'transcripts', 'audit', 'file_versions', 'logs', 'events', 'backups', 'memory', 'records');
const holdKind = t.enm('file', 'channel', 'thread', 'folder', 'person');
const recordTypeOpt = t.opt(id.recordType);
const holdTarget = t.obj({ kind: holdKind, id: t.str({ examples: ['fil_a1b2c3'] }) });
const eraseKind = t.enm('records', 'files', 'chats', 'inbox', 'mail', 'calls', 'memory', 'runs');
const retentionRow = t.obj({
  key: kind, title: t.str(), default: t.str({ examples: ['30d'] }), value: t.str({ examples: ['30d'] }), overridden: t.bool(), holdable: t.bool(), tombstone: t.bool(),
  perRecordType: t.opt(t.rec(t.str())),
});
const jobRow = t.obj({ kind, lastRunAt: t.opt(t.ts()), nextRunAt: t.opt(t.ts()), lastRemoved: t.opt(t.int({ minimum: 0 })), lastSkippedOnHold: t.opt(t.int({ minimum: 0 })), state: t.enm('idle', 'running', 'failed') });
const findingGroup = t.obj({ kind: eraseKind, count: t.int({ minimum: 0 }), onHold: t.int({ minimum: 0 }), samples: t.arr(t.obj({ type: t.str(), id: t.str(), title: t.str() })) });
const eraseRow = t.obj({ findingId: t.id('fnd'), by: t.str(), at: t.ts(), kinds: t.arr(eraseKind), tombstones: t.int({ minimum: 0 }) });
const tombstoneRow = t.obj({ id: t.id('tmb'), kind: t.str(), at: t.ts(), by: t.str() });

export default defineManifest({
  id: 'governance',
  title: 'Governance',
  owner: 'L7a',

  events: [
    ev('retention.purged', 'A retention job removed or compacted data of one kind (counts only)', { p: { kind, removed: t.int({ minimum: 0 }), skippedOnHold: t.int({ minimum: 0 }) }, subject: ['entity', '/kind'], retention: 'audit' }),
    ev('hold.placed', 'A hold now blocks expiry and erasing', { p: { target: holdTarget, reason: t.str(), by: t.str() }, subject: ['entity', '/target/id'], retention: 'audit' }),
    ev('hold.released', 'A hold was released', { p: { target: holdTarget, by: t.str() }, subject: ['entity', '/target/id'], retention: 'audit' }),
    ev('erase.started', 'Erasing a person\'s data started (who and when; never what)', { p: { findingId: t.id('fnd'), by: t.str(), overrodeHold: t.bool() }, subject: ['entity', '/findingId'], retention: 'audit' }),
    ev('erase.completed', 'Erasing finished; tombstones are written and the next backup rotation purges the rest', { p: { findingId: t.id('fnd'), tombstones: t.int({ minimum: 0 }) }, subject: ['entity', '/findingId'], retention: 'audit' }),
    ev('tombstones.reapplied', 'Tombstones were replayed after a restore, before the Space opened for traffic', { p: { count: t.int({ minimum: 0 }) }, subject: ['entity', '/count'], retention: 'audit' }),
  ],

  capabilities: [
    // ---- retention
    read('governance.retention.get', 'Retention for every kind of data: default, value in force, overrides, whether holds and tombstones apply', { ...V, in: {}, out: { kinds: t.arr(retentionRow) }, perm: 'policy.manage', tool: 'engineer', team: true }),
    write('governance.retention.set', 'Set retention for one kind (for example 90d, 2y, forever), or for one record type when the kind is records', {
      ...V, in: { kind, value: t.str({ pattern: '^(forever|per_policy|[0-9]+[dwmy])$', examples: ['90d'] }), recordType: recordTypeOpt }, out: { row: retentionRow }, perm: 'policy.manage', emits: ['policy.changed'], audit: 'always', risk: 'high', tool: 'engineer', team: true,
    }),
    write('governance.retention.reset', 'Put one kind back to its default', { ...V, in: { kind, recordType: recordTypeOpt }, out: { row: retentionRow }, perm: 'policy.manage', emits: ['policy.changed'], audit: 'always', tool: 'engineer', team: true }),
    read('governance.jobs.list', 'The retention jobs: last run, next run, what was removed, what a hold skipped', { ...V, in: {}, out: { jobs: t.arr(jobRow) }, perm: 'policy.manage', tool: 'engineer', team: true }),
    write('governance.jobs.run_now', 'Run one retention job now', { ...V, idem: 'key', in: { kind }, out: { runId: id.run }, perm: 'policy.manage', run: { kind: 'retention', stoppable: true }, emits: ['retention.purged'], audit: 'always', tool: 'engineer', team: true }),
    write('governance.jobs.tick', 'System: the daily job for one kind; deletes or compacts what is past retention and skips what a hold covers', {
      ...V, in: { kind }, out: { removed: t.int({ minimum: 0 }), skippedOnHold: t.int({ minimum: 0 }) }, emits: ['retention.purged'], audit: 'always',
    }),

    // ---- holds
    read('governance.holds.list', 'Everything under a hold', { ...V, in: { kind: t.opt(holdKind), ...pageIn }, out: { holds: t.arr(t.obj({ target: holdTarget, title: t.str(), reason: t.str(), by: t.str(), at: t.ts() })), ...pageOut }, perm: 'records.hold', tool: 'meta' }),
    write('governance.holds.place', 'Place a hold on a file, channel, thread, folder or person; it shows On hold and blocks expiry and erasing', {
      ...V, in: { target: holdTarget, reason: t.str() }, out: ok, perm: 'records.hold', emits: ['hold.placed'], audit: 'always', tool: 'meta',
    }),
    write('governance.holds.release', 'Release a hold', { ...V, in: { target: holdTarget }, out: ok, perm: 'records.hold', emits: ['hold.released'], audit: 'always', tool: 'meta' }),

    // ---- erase a person
    read('governance.erase.find', 'Find everything about one contact across records, files, chats, inbox, mail, calls, memory and runs, and show it', {
      ...V, in: { subject: t.obj({ recordId: t.opt(id.record), email: t.opt(email), phone: t.opt(t.str()), name: t.opt(t.str()) }) }, out: { findingId: t.id('fnd'), groups: t.arr(findingGroup), expiresAt: t.ts() },
      perm: 'policy.manage', risk: 'high', audit: 'always', tool: 'engineer', team: true, label: 'filter',
    }),
    write('governance.erase.apply', 'Erase what a finding lists: tombstones are written, an audit entry records who and when, the next backup rotation purges the rest', {
      ...V, idem: 'key', in: { findingId: t.id('fnd'), include: t.arr(eraseKind), overrideHold: t.opt(t.obj({ reason: t.str() })) }, out: { runId: id.run },
      perm: 'policy.manage', emits: ['erase.started', 'erase.completed'], gate: { act: 'delete', when: "actor.kind != 'person'" }, audit: 'always', risk: 'high', run: { kind: 'erase', stoppable: false }, tool: 'engineer', team: true, errors: ['permission.on_hold'],
    }),
    read('governance.erase.list', 'Past erasures: who, when and which kinds (never what)', { ...V, in: { ...pageIn }, out: { erasures: t.arr(eraseRow), ...pageOut }, perm: 'policy.manage', tool: 'engineer', team: true }),
    read('governance.tombstones.list', 'Tombstones that a restore will replay (kinds and times only)', { ...V, in: { ...pageIn }, out: { tombstones: t.arr(tombstoneRow), ...pageOut }, perm: 'policy.manage', tool: 'engineer', team: true }),
    write('governance.tombstones.reapply', 'System: replay every tombstone after a restore, before the Space opens for traffic; `tombstones` are the ones the Space held before the restore, which the restored database does not have', {
      ...V, in: { tombstones: t.opt(t.arr(t.obj({ id: t.str(), kind: t.str(), subjectType: t.str(), subjectId: t.str(), at: t.ts(), by: t.str(), findingId: t.opt(t.str()) }))) },
      out: { count: t.int({ minimum: 0 }) }, emits: ['tombstones.reapplied'], audit: 'always',
      // never holds (the condition is never true): the replay is the host's own, and the erase it repeats was approved when it was made. The act is declared so that the deletes it makes inherit it as settled.
      gate: { act: 'delete', when: 'actor.kind != actor.kind' },
    }),

    read('governance.jobs_health', 'Health probe: retention jobs ran on schedule', { ...V, in: {}, out: { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int({ minimum: 0 })) } }),
  ],

  retention: [
    retention('trash', 'Trash (records, files)', '30d', { tombstone: false }),
    retention('run_logs', 'Run logs and run chats', '90d', { tombstone: false }),
    retention('transcripts', 'Chat transcripts', '1y'),
    retention('audit', 'Audit entries (then archived, never edited)', '2y', { tombstone: false }),
    retention('file_versions', 'File versions (all for 30 days, then daily for 90 days, then monthly unless named)', '30d+daily90d+monthly', { tombstone: false }),
    retention('logs', 'Logs (full 30 days, aggregates 180 days)', '30d', { holdable: false, tombstone: false }),
    retention('events', 'Events (state-bearing forever; other payloads compacted after 30 days)', 'forever'),
    retention('backups', 'Backups (rotation per policy; an erase purges the next rotation)', 'per_policy', { holdable: false, tombstone: false }),
    retention('memory', 'Memory notes and facts', 'forever'),
    retention('records', 'Records (per record type)', 'forever'),
  ],

  screens: [
    screen('governance.retention', 'console', 'ui:ConsoleRetention', {
      needs: ['policy.manage'], q: { kinds: ['governance.retention.get'], jobs: ['governance.jobs.list'] },
      a: { set: ['governance.retention.set', { kind: '/state/kind', value: '/state/value', recordType: '/state/recordType' }], reset: ['governance.retention.reset', { kind: '/state/kind', recordType: '/state/recordType' }, 'Back to the default?'], run: ['governance.jobs.run_now', { kind: '/state/kind' }, 'Run this job now?'] },
    }),
    screen('governance.holds', 'console', 'ui:ConsoleHolds', { needs: ['records.hold'], q: { holds: ['governance.holds.list', { kind: '/state/kind' }] }, a: { place: ['governance.holds.place', { target: '/state/target', reason: '/state/reason' }], release: ['governance.holds.release', { target: '/state/target' }, 'Release this hold?'] }, empty: 'Nothing is on hold' }),
    screen('governance.erase', 'console', 'ui:ConsoleErase', {
      needs: ['policy.manage'], q: { past: ['governance.erase.list'] },
      a: { find: ['governance.erase.find', { subject: '/state/subject' }], apply: ['governance.erase.apply', { findingId: '/state/findingId', include: '/state/include', overrideHold: '/state/overrideHold' }, 'Erase this data for good?'] }, empty: 'No erasures yet', primary: 'Find a person',
    }),
  ],

  health: [
    health('governance.retention', 'Retention jobs', 'governance.jobs_health', 'Open Console > Data > Retention and run the late job now'),
  ],

  settings: [
    setting('retention.overrides', 'space', 'console.data', 'Retention overrides', t.rec(t.str()), {}),
  ],
});
