// Freeze review of built-in record schemas (spec 2.9, 2.10; ARCH 3.3, 7.4).
// Each reviewed schema has fields, a sensitivity label on every field, a sync profile,
// a replica version column, and One History (versions + restore_version) where the type keeps versions.
// Record types share records.versions and records.restore_version. File has files.versions and files.restore_version.
// @reads generated/sync/entities.ts
// @reads generated/sync/replica.sql
// @reads generated/registry.json
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

interface SyncField { type: string; label: string | null; required: boolean }
interface SyncRow {
  kind: 'entity' | 'record_type';
  key: string;
  table: string;
  idPrefix: string;
  module: string;
  sync: {
    profile: { desktop: string; phone: string; web: string };
    window?: Record<string, unknown>;
    maxLabel?: string;
    text?: string[];
    protectedFields?: string[];
  };
  fields: Record<string, SyncField>;
}
interface RegField { key: string; type: string; title: string; label?: string; required?: boolean; options?: { target?: string; inverse?: string } }
interface RegType { key: string; module: string; label: string; titleField: string; summaryField?: string; statusField?: string; ownerField?: string; group?: string; system?: boolean; template?: 'project' | null; workspace?: boolean; attribution?: boolean; fields: RegField[] }
interface RegEntityField { type: string; label?: string; required?: boolean }
interface RegEntity { key: string; fields: Record<string, RegEntityField> }
interface RegistryShape { capabilities: Array<{ name: string }>; recordTypes: RegType[]; entities: RegEntity[] }

function loadSync(src: string): SyncRow[] {
  const marker = 'export const syncEntities: SyncEntityConfig[] = ';
  const at = src.indexOf(marker);
  assert.ok(at >= 0, 'sync entity list');
  const end = src.indexOf(';\n\nexport const syncEntityByKey', at);
  assert.ok(end > at, 'sync entity list end');
  return JSON.parse(src.slice(at + marker.length, end)) as SyncRow[];
}

function createBody(sql: string, table: string): string {
  const mark = `CREATE TABLE IF NOT EXISTS "${table}" (`;
  const start = sql.indexOf(mark);
  assert.ok(start >= 0, table);
  const end = sql.indexOf('\n);', start);
  assert.ok(end > start, `${table} close`);
  return sql.slice(start, end);
}

type Profile = { readonly desktop: string; readonly phone: string; readonly web: string };
const allWindowAll: Profile = { desktop: 'all', phone: 'window', web: 'all' };
const allAllAll: Profile = { desktop: 'all', phone: 'all', web: 'all' };
const allWindowWindow: Profile = { desktop: 'all', phone: 'window', web: 'window' };
const windowAll: Profile = { desktop: 'window', phone: 'window', web: 'window' };
const rtWindow = { recentCount: 500, starred: true };

interface Frozen {
  key: string;
  kind: 'entity' | 'record_type';
  module: string;
  table: string;
  idPrefix: string;
  profile: Profile;
  window: Record<string, number | boolean> | null;
  maxLabel: string | null;
  protectedFields: string[] | null;
  text: string[] | null;
  /** key|type|title|label. A trailing ! on the type means required. An empty title means the schema has no display title (entities). An empty label means null. */
  fields: readonly string[];
  versions: string | null;
  restore: string | null;
  rel?: Record<string, readonly [string, string | null]>;
  summaryField?: string | null;
  statusField?: string | null;
  ownerField?: string | null;
  group?: string | null;
  system?: boolean;
  template?: 'project' | null;
  workspace?: boolean;
  attribution?: boolean;
}

function col(rows: readonly string[]): Array<{ key: string; type: string; title: string; label: string | null; required: boolean }> {
  return rows.map((row) => {
    const parts = row.split('|');
    const key = parts[0] ?? '';
    const raw = parts[1] ?? '';
    const required = raw.endsWith('!');
    const type = required ? raw.slice(0, -1) : raw;
    const title = parts[2] ?? '';
    const label = parts[3] ?? '';
    return { key, type, title, label: label === '' ? null : label, required };
  });
}

const FROZEN: readonly Frozen[] = [
  {
    key: 'contact', kind: 'record_type', module: 'contacts-link', table: 'rt_contact', idPrefix: 'rec_',
    profile: allWindowAll, window: rtWindow, maxLabel: 'internal', protectedFields: ['owner'], text: [],
    versions: 'records.versions', restore: 'records.restore_version',
    summaryField: 'company', ownerField: 'owner', group: 'People', attribution: true,
    rel: { company: ['company', 'contacts'] },
    fields: [
      'name|text!|Name|', 'title|text|Job title|', 'email|email|Email|', 'phone|phone|Phone|',
      'company|relation|Company|', 'owner|person|Owner|', 'deliverability|choice|Deliverability|',
      'pref_email_consent|choice|Email consent|', 'pref_sms_consent|choice|SMS consent|',
      'pref_do_not_contact|checkbox|Do not contact|', 'pref_opt_outs|multichoice|Channel opt-outs|',
      'pref_source|text|Preference source|', 'pref_at|datetime|Preference time|',
    ],
  },
  {
    key: 'company', kind: 'record_type', module: 'contacts-link', table: 'rt_company', idPrefix: 'rec_',
    profile: allWindowAll, window: rtWindow, maxLabel: 'internal', protectedFields: ['owner'], text: [],
    versions: 'records.versions', restore: 'records.restore_version',
    ownerField: 'owner', group: 'People', attribution: true,
    rel: { contacts: ['contact', 'company'] },
    fields: [
      'name|text!|Name|', 'website|url|Website|', 'phone|phone|Phone|', 'address|address|Address|',
      'owner|person|Owner|', 'contacts|relation|People|',
    ],
  },
  {
    key: 'project', kind: 'record_type', module: 'projects', table: 'rt_project', idPrefix: 'rec_',
    profile: allWindowAll, window: rtWindow, maxLabel: 'internal', protectedFields: ['status', 'lead'], text: ['goal', 'status_update'],
    versions: 'records.versions', restore: 'records.restore_version',
    summaryField: 'summary', statusField: 'status', ownerField: 'lead', group: 'Work', template: 'project', workspace: true,
    fields: [
      'title|text!|Name|', 'summary|text|Summary|', 'status|status|Status|', 'lead|person|Lead|',
      'start|datetime|Start|', 'due|datetime|Due|', 'goal|longtext|Brief and goal|',
      'status_update|longtext|Status update|', 'status_update_at|datetime|Updated|',
      'stages|multichoice|Stages|', 'channel|text|Channel|', 'folder|text|Folder|', 'pinned_files|files|Pinned files|',
    ],
  },
  {
    key: 'task', kind: 'record_type', module: 'projects', table: 'rt_task', idPrefix: 'rec_',
    profile: allWindowAll, window: rtWindow, maxLabel: 'internal', protectedFields: ['status'], text: ['why', 'notes'],
    versions: 'records.versions', restore: 'records.restore_version',
    summaryField: 'summary', statusField: 'status', ownerField: 'assigned', group: 'Work', system: true,
    rel: { project: ['project', 'tasks'], parent: ['task', 'subtasks'], depends_on: ['task', 'blocks'] },
    fields: [
      'title|text!|Title|', 'summary|text|Summary|', 'why|longtext|Why|', 'kind|choice|Kind|', 'status|status|Status|',
      'project|relation|Project|', 'stage|text|Stage|', 'assigned|text|Assigned|', 'reviewer|text|Reviewer|',
      'approver|text|Approver|', 'start|datetime|Start|', 'due|datetime|Due|', 'effort|duration|Effort|',
      'milestone|checkbox|Milestone|', 'parent|relation|Parent task|', 'depends_on|relation|Depends on|',
      'order|number|Order|', 'source|text|Source|', 'thread|text|Thread|', 'attachments|files|Files|',
      'notes|longtext|Working notes|',
    ],
  },
  {
    key: 'meeting', kind: 'record_type', module: 'meetings', table: 'rt_meeting', idPrefix: 'rec_',
    profile: allWindowAll, window: rtWindow, maxLabel: 'internal', protectedFields: ['status', 'organizer'], text: ['transcript', 'summary', 'decisions'],
    versions: 'records.versions', restore: 'records.restore_version',
    summaryField: 'summary', statusField: 'status', ownerField: 'organizer', group: 'Activity',
    rel: { attendees: ['contact', null] },
    fields: [
      'title|text!|Title|', 'starts_at|datetime|Starts|', 'ends_at|datetime|Ends|', 'provider|choice|Provider|',
      'join_url|url|Join link|', 'status|status|Status|', 'organizer|person|Organizer|', 'attendees|relation|Attendees|',
      'calendar_event_id|text|Calendar event|', 'provider_ref|text|Provider meeting id|', 'recording|files|Recording|',
      'recording_state|choice|Recording state|', 'transcript|longtext|Transcript|confidential', 'summary|longtext|Summary|',
      'decisions|longtext|Decisions|',
    ],
  },
  {
    key: 'mailbox', kind: 'entity', module: 'mail', table: 'mail_mailbox', idPrefix: 'mbx_',
    profile: allWindowAll, window: null, maxLabel: null, protectedFields: ['privacy', 'state'], text: null,
    versions: null, restore: null,
    fields: [
      'kind|choice||', 'address|email||', 'title|text||', 'ownerId|person||', 'agentId|text||', 'provider|choice||',
      'privacy|choice||', 'state|status||', 'connectionId|text||', 'lastSyncAt|datetime||', 'paused|checkbox||',
    ],
  },
  {
    key: 'number', kind: 'entity', module: 'telephony', table: 'telephony_number', idPrefix: 'num_',
    profile: allAllAll, window: null, maxLabel: null, protectedFields: ['assigneeId', 'recording', 'state'], text: null,
    versions: null, restore: null,
    fields: [
      'e164|phone||', 'title|text||', 'capabilities|multichoice||', 'assigneeKind|choice||', 'assigneeId|text||',
      'route|text||', 'hours|text||', 'recording|choice||', 'a2p|choice||', 'state|status||', 'twilioSid|text||',
    ],
  },
  {
    key: 'conversation', kind: 'entity', module: 'inbox', table: 'inbox_conversation', idPrefix: 'cnv_',
    profile: allWindowWindow, window: { days: 90, recentCount: 300 }, maxLabel: null, protectedFields: ['needsMatch'], text: null,
    versions: null, restore: null,
    fields: [
      'contactId|text||', 'address|text||', 'displayName|text||', 'lastMessageAt|datetime||', 'lastChannel|choice||',
      'lastPreview|text||', 'unreadCount|number||', 'needsMatch|checkbox||', 'ownerId|person||', 'mailboxIds|text||',
      'numberIds|text||', 'campaignId|text||',
    ],
  },
  {
    key: 'call', kind: 'entity', module: 'telephony', table: 'telephony_call', idPrefix: 'cal_',
    profile: windowAll, window: { days: 90, recentCount: 300 }, maxLabel: 'confidential', protectedFields: null, text: null,
    versions: null, restore: null,
    fields: [
      'numberId|text||', 'direction|choice||', 'from|text||', 'to|text||', 'contactId|text||', 'state|status||',
      'startedAt|datetime||', 'answeredAt|datetime||', 'endedAt|datetime||', 'durationSec|duration||', 'handledBy|text||',
      'recordingFileId|text||', 'transcript|longtext||confidential', 'summary|longtext||', 'consentLogged|checkbox||',
      'twilioSid|text||', 'traceId|text||',
    ],
  },
  {
    key: 'sms', kind: 'entity', module: 'telephony', table: 'telephony_sms', idPrefix: 'sms_',
    profile: windowAll, window: { days: 90, recentCount: 500 }, maxLabel: 'confidential', protectedFields: null, text: null,
    versions: null, restore: null,
    fields: [
      'numberId|text||', 'direction|choice||', 'from|text||', 'to|text||', 'body|longtext||confidential', 'status|status||',
      'contactId|text||', 'mediaFileIds|files||', 'campaignId|text||', 'at|datetime||', 'twilioSid|text||', 'traceId|text||',
    ],
  },
  {
    key: 'calendar_event', kind: 'entity', module: 'calendar', table: 'calendar_event', idPrefix: 'cev_',
    profile: windowAll, window: { days: 120, recentCount: 500 }, maxLabel: null, protectedFields: ['status'], text: null,
    versions: null, restore: null,
    fields: [
      'calendarId|text||', 'title|text||', 'startsAt|datetime||', 'endsAt|datetime||', 'allDay|checkbox||', 'location|text||',
      'joinUrl|url||', 'joinProvider|choice||', 'description|longtext||', 'agenda|longtext||', 'attendees|text||',
      'organizer|email||', 'recordIds|text||', 'meetingId|text||', 'providerId|text||', 'status|status||',
      'bookedByAgentId|text||', 'fromBookingPage|text||', 'deletedAt|datetime||',
    ],
  },
  {
    key: 'digest', kind: 'entity', module: 'home', table: 'home_digests', idPrefix: 'dgs_',
    profile: allAllAll, window: { days: 14, recentCount: 20 }, maxLabel: null, protectedFields: null, text: null,
    versions: null, restore: null,
    fields: [
      'person|person||', 'period_start|datetime||', 'period_end|datetime||', 'headline|text||', 'items|text||',
      'seen_at|datetime||', 'built_by|text||',
    ],
  },
  {
    key: 'folder', kind: 'entity', module: 'access', table: 'access_folders', idPrefix: 'fld_',
    profile: allWindowAll, window: null, maxLabel: null, protectedFields: null, text: null,
    versions: null, restore: null,
    fields: [
      'resourceType|choice||', 'name|text||', 'parentId|text||', 'scope|choice||', 'owner|text||', 'createdAt|datetime||',
    ],
  },
  {
    key: 'file', kind: 'entity', module: 'files', table: 'files_file', idPrefix: 'fil_',
    profile: allWindowWindow, window: { recentCount: 200, starred: true }, maxLabel: null, protectedFields: null, text: null,
    versions: 'files.versions', restore: 'files.restore_version',
    fields: [
      'folder_id|text||', 'name|text||', 'kind|choice||', 'mime|text||', 'size|number||', 'version|number||', 'blob|text||',
      'owner|text||', 'source_mount|text||', 'created_at|datetime||', 'updated_at|datetime||', 'updated_by|text||', 'deleted_at|datetime||',
    ],
  },
];

const syncByKey = new Map(loadSync(read('generated/sync/entities.ts')).map((row) => [row.key, row] as const));
const registry = JSON.parse(read('generated/registry.json')) as RegistryShape;
const capNames = new Set(registry.capabilities.map((c) => c.name));
const replica = read('generated/sync/replica.sql');
const typeByKey = new Map(registry.recordTypes.map((row) => [row.key, row] as const));
const entityByKey = new Map(registry.entities.map((row) => [row.key, row] as const));

test('each reviewed schema has fields with labels, a sync profile, a version column, and versions plus restore_version', () => {
  assert.deepEqual(FROZEN.map((row) => row.key), [
    'contact', 'company', 'project', 'task', 'meeting', 'mailbox', 'number', 'conversation', 'call', 'sms', 'calendar_event', 'digest', 'folder', 'file',
  ]);
  assert.ok(capNames.has('records.versions') && capNames.has('records.restore_version'));
  assert.ok(capNames.has('files.versions') && capNames.has('files.restore_version'));

  for (const row of FROZEN) {
    const sync = syncByKey.get(row.key);
    assert.ok(sync, row.key);
    assert.equal(sync.kind, row.kind, row.key);
    assert.equal(sync.module, row.module, row.key);
    assert.equal(sync.table, row.table, row.key);
    assert.equal(sync.idPrefix, row.idPrefix, row.key);
    assert.deepEqual(sync.sync.profile, row.profile, `${row.key} sync profile`);
    assert.deepEqual(sync.sync.window ?? null, row.window, `${row.key} window`);
    assert.equal(sync.sync.maxLabel ?? null, row.maxLabel, `${row.key} maxLabel`);
    assert.deepEqual(sync.sync.protectedFields ?? null, row.protectedFields, `${row.key} protected`);
    assert.deepEqual(sync.sync.text ?? null, row.text, `${row.key} text`);

    const want = col(row.fields);
    assert.ok(want.length > 0, `${row.key} fields`);
    const got = Object.entries(sync.fields).map(([key, field]) => [key, field.type, field.label, field.required]);
    assert.deepEqual(got, want.map((field) => [field.key, field.type, field.label, field.required]), `${row.key} fields`);
    for (const field of want) {
      assert.equal(typeof field.label === 'string' || field.label === null, true, `${row.key}.${field.key} label`);
      if (row.kind === 'record_type') assert.ok(field.title.length > 0, `${row.key}.${field.key} label`);
    }

    if (row.kind === 'record_type') {
      const rt = typeByKey.get(row.key);
      assert.ok(rt, row.key);
      assert.equal(rt.module, row.module);
      assert.equal(rt.label, 'internal', `${row.key} type label`);
      assert.equal(rt.titleField, want[0]?.key, `${row.key} title field`);
      assert.equal(rt.summaryField ?? null, row.summaryField ?? null);
      assert.equal(rt.statusField ?? null, row.statusField ?? null);
      assert.equal(rt.ownerField ?? null, row.ownerField ?? null);
      assert.equal(rt.group ?? null, row.group ?? null);
      assert.equal(rt.system ?? false, row.system ?? false);
      assert.equal(rt.template ?? null, row.template ?? null);
      assert.equal(rt.workspace ?? false, row.workspace ?? false);
      assert.equal(rt.attribution ?? false, row.attribution ?? false);
      assert.deepEqual(
        rt.fields.map((field) => [field.key, field.type, field.title, field.label ?? null, field.required === true]),
        want.map((field) => [field.key, field.type, field.title, field.label, field.required]),
        `${row.key} registry fields`,
      );
      for (const [key, target] of Object.entries(row.rel ?? {})) {
        const field = rt.fields.find((item) => item.key === key);
        assert.equal(field?.options?.target, target[0], `${row.key}.${key} target`);
        assert.equal(field?.options?.inverse ?? null, target[1], `${row.key}.${key} inverse`);
      }
      assert.equal(row.versions, 'records.versions');
      assert.equal(row.restore, 'records.restore_version');
    } else {
      const entity = entityByKey.get(row.key);
      assert.ok(entity, row.key);
      for (const field of want) {
        const live = entity.fields[field.key];
        assert.ok(live, `${row.key}.${field.key}`);
        assert.equal(live.type, field.type);
        assert.equal(live.label ?? null, field.label);
      }
    }

    if (row.versions !== null && row.restore !== null) {
      assert.ok(capNames.has(row.versions), `${row.key} versions`);
      assert.ok(capNames.has(row.restore), `${row.key} restore_version`);
    } else {
      assert.equal(capNames.has(`${row.key}.versions`), false, `${row.key} has no own versions capability`);
      assert.equal(capNames.has(`${row.key}.restore_version`), false, `${row.key} has no own restore_version capability`);
    }
    assert.match(createBody(replica, row.table), /"version" INTEGER NOT NULL DEFAULT 0/, `${row.table} version`);
  }
});
// run on the final commit of the kit stages PR

// run on the final commit of P-CC_32
