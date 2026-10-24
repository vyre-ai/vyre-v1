// records (lane L3): rows of every record type, the RecordStore facade (4.3.1), field types and view kinds.
// This file is the reference for the style of every other manifest.
import { create, defineManifest, ev, ftype, read, t, vkind, write } from '../packages/contracts/src/index.ts';
import type { FieldTypeDef } from '../packages/contracts/src/index.ts';
import { block } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut, viewSpec, versionRow } from './_common.ts';

const recordRow = t.obj({
  id: id.record, type: id.recordType, version: t.int(), label: t.int({ minimum: 0, maximum: 3 }),
  fields: t.rec(), createdAt: t.ts(), updatedAt: t.ts(), deletedAt: t.opt(t.ts()), holds: t.int(),
});
const target = { type: id.recordType, recordId: id.record };
const valueSource = t.obj({
  kind: t.enm('agent', 'person', 'form', 'automation', 'sync', 'import'), actor: t.str(), link: t.opt(t.str({ description: 'Link to the exact chat, task, run or record the value came from' })),
  at: t.ts(), state: t.enm('counted', 'needs_review', 'rejected'),
});
const pendingValue = t.obj({ recordId: id.record, type: id.recordType, field: t.str(), value: t.opt(t.json()), source: valueSource });

const text = (key: string, title: string, o: Partial<FieldTypeDef> = {}) =>
  ftype(key, title, t.str(), { filterOps: ['eq', 'ne', 'contains', 'starts', 'in', 'empty', 'notempty'], ...o });
const num = (key: string, title: string, o: Partial<FieldTypeDef> = {}) =>
  ftype(key, title, t.num(), { storage: { columns: [{ suffix: '', sql: 'REAL' }] }, filterOps: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'empty', 'notempty'], ...o });
const when = (key: string, title: string, o: Partial<FieldTypeDef> = {}) =>
  ftype(key, title, t.ts(), { storage: { columns: [{ suffix: '', sql: 'INTEGER' }] }, filterOps: ['eq', 'gt', 'gte', 'lt', 'lte', 'between', 'empty', 'notempty'], ...o });

export default defineManifest({
  id: 'records',
  title: 'Records',
  owner: 'L3',
  events: [
    ev('record.created', 'A record was created; fields carries the initial values (sealed and Restricted values as ciphertext only)', { p: { recordId: id.record, type: id.recordType, fields: t.rec(t.json()) }, subject: ['record', '/recordId'], label: 'subject', trigger: { title: 'A record is created', fields: ['/type'] } }),
    ev('record.updated', 'Fields of a record changed; fields carries the new values and prev the old ones (sealed and Restricted values as ciphertext only)', { p: { recordId: id.record, type: id.recordType, fields: t.rec(t.json()), prev: t.rec(t.json()), version: t.int() }, subject: ['record', '/recordId'], label: 'subject', trigger: { title: 'A record changes', fields: ['/type', '/fields'] } }),
    ev('record.deleted', 'A record moved to Trash; prev carries the values it held (sealed and Restricted values as ciphertext only)', { p: { recordId: id.record, type: id.recordType, prev: t.rec(t.json()) }, subject: ['record', '/recordId'], label: 'subject', trigger: { title: 'A record is deleted' } }),
    ev('record.restored', 'A record came back from Trash', { p: { recordId: id.record, type: id.recordType }, subject: ['record', '/recordId'], label: 'subject' }),
    ev('record.merged', 'Two records were merged into a survivor', { p: { survivorId: id.record, mergedId: id.record, type: id.recordType }, subject: ['record', '/survivorId'], label: 'subject' }),
    ev('record.held', 'A hold was placed on a record', { p: { recordId: id.record, type: id.recordType, reason: t.str() }, subject: ['record', '/recordId'], label: 'subject' }),
    ev('record.hold_released', 'A hold was released', { p: { recordId: id.record, type: id.recordType }, subject: ['record', '/recordId'], label: 'subject' }),
    ev('field.revealed', 'A sealed field was revealed to one actor (audited)', { p: { recordId: id.record, type: id.recordType, field: t.str() }, subject: ['record', '/recordId'], vis: 'participants', label: 'subject' }),
    ev('record.value_proposed', 'An agent or automation filled a value; it waits for review or counts straight away, per field', { p: { recordId: id.record, type: id.recordType, field: t.str(), source: valueSource, reviewRequired: t.bool() }, subject: ['record', '/recordId'], label: 'subject' }),
    ev('record.value_reviewed', 'A reviewer accepted or rejected an agent-filled value', { p: { recordId: id.record, type: id.recordType, field: t.str(), decision: t.enm('accepted', 'rejected'), by: t.str() }, subject: ['record', '/recordId'], label: 'subject' }),
    ev('record.gaps_found', 'A gap-check rule found missing or stale fields on a record', { p: { recordId: id.record, type: id.recordType, fields: t.arr(t.str()), ruleId: t.str() }, subject: ['record', '/recordId'], label: 'subject', trigger: { title: 'A record has gaps', fields: ['/type'] } }),
  ],
  blocks: [
    block('record_card', { recordId: id.record, type: id.recordType, title: t.str(), summary: t.opt(t.str()), status: t.opt(t.str()), fields: t.arr(t.obj({ key: t.str(), title: t.str(), value: t.json() })) },
      '{{title}} ({{type}})', { opens: { tab: 'record', input: { recordId: '/recordId' } } }),
  ],
  capabilities: [
    read('records.get', 'Read one record by id', { in: target, out: { record: recordRow }, on: ['record', '/recordId'], tool: 'records', label: 'check', cli: 'vyre records get' }),
    read('records.query', 'Query rows of a record type with filter, sort, group and window', {
      in: { type: id.recordType, ...viewSpec, ...pageIn }, out: { rows: t.arr(recordRow), ...pageOut },
      on: ['record_type', '/type'], tool: 'records', label: 'filter', cli: 'vyre records query',
    }),
    read('records.search', 'Search rows by text across a record type', { in: { type: id.recordType, q: t.str(), ...pageIn }, out: { rows: t.arr(recordRow), ...pageOut }, on: ['record_type', '/type'], tool: 'records', label: 'filter' }),
    read('records.changes', 'Change feed of a record type since a sequence number (RecordStore.changes)', { in: { type: id.recordType, since: t.int({ minimum: 0 }), limit: t.opt(t.int()) }, out: { changes: t.arr(t.obj({ seq: t.int(), id: id.record, op: t.enm('upsert', 'patch', 'delete') })), next: t.int() }, on: ['record_type', '/type'] }),
    read('records.history', 'Field history of a record: previous values and merge losers', { in: { ...target, field: t.opt(t.str()) }, out: { entries: t.arr(t.obj({ field: t.str(), value: t.json(), hlc: t.str(), actor: t.str(), reason: t.opt(t.str()) })) }, on: ['record', '/recordId'], tool: 'records' }),
    read('records.as_of', 'Read a record as it was at a time', { in: { ...target, at: t.ts() }, out: { record: recordRow }, on: ['record', '/recordId'], tool: 'records' }),
    read('records.versions', 'List versions of a record (One History)', { in: target, out: { versions: t.arr(versionRow) }, on: ['record', '/recordId'], tool: 'records' }),
    write('records.restore_version', 'Restore a record to an earlier version', { in: { ...target, versionId: id.version }, out: { record: recordRow }, on: ['record', '/recordId'], perm: 'records.edit', emits: ['record.updated'], tool: 'records', agent: { planMode: 'blocked' } }),
    create('records.create', 'Create a record', {
      in: { type: id.recordType, fields: t.rec() }, out: { record: recordRow }, make: ['record', '/type'], perm: 'records.create',
      emits: ['record.created'], tool: 'records', offline: 'queue', cli: 'vyre records create',
    }),
    write('records.update', 'Update fields of a record (per-field merge for sync, base version for API callers)', {
      in: { ...target, patch: t.rec(), baseVersion: t.opt(t.int()) }, out: { record: recordRow }, on: ['record', '/recordId'], perm: 'records.edit',
      emits: ['record.updated', 'record.value_proposed'], tool: 'records', offline: 'patch', errors: ['validation.field_locked', 'validation.version_conflict', 'validation.duplicate'], hook: true,
    }),
    create('records.bulk_upsert', 'Create or update many records by match key, quietly (no automations unless asked)', {
      in: { type: id.recordType, rows: t.arr(t.rec()), match: t.arr(t.str()), runAutomations: t.opt(t.bool()) },
      out: { created: t.int(), updated: t.int(), skipped: t.int() }, make: ['record', '/type'], perm: 'records.create', emits: ['record.created', 'record.updated'], tool: 'records', cli: 'vyre records upsert',
    }),
    write('records.delete', 'Move a record to Trash', { in: target, out: { deleted: t.bool() }, on: ['record', '/recordId'], perm: 'records.delete', emits: ['record.deleted'], gate: { act: 'delete', when: "actor.kind != 'person'" }, tool: 'records', offline: 'queue', errors: ['permission.on_hold'] }),
    write('records.restore', 'Restore a record from Trash', { in: target, out: { record: recordRow }, on: ['record', '/recordId'], perm: 'records.delete', emits: ['record.restored'], tool: 'records' }),
    write('records.merge', 'Merge records into a survivor with a value picked per field (undoable for 30 days)', {
      in: { type: id.recordType, survivorId: id.record, mergedIds: t.arr(id.record), picks: t.rec(t.str()) }, out: { record: recordRow, undoUntil: t.ts() },
      on: ['record', '/survivorId'], perm: 'records.delete', emits: ['record.merged'], audit: 'always', tool: 'records',
    }),
    write('records.hold', 'Place a hold on a record', { in: { ...target, reason: t.str() }, out: { held: t.bool() }, on: ['record', '/recordId'], perm: 'records.hold', emits: ['record.held'], audit: 'always', tool: 'records' }),
    write('records.release_hold', 'Release a hold on a record', { in: target, out: { released: t.bool() }, on: ['record', '/recordId'], perm: 'records.hold', emits: ['record.hold_released'], audit: 'always', tool: 'records' }),
    read('records.reveal', 'Reveal a sealed field to the caller (asked once, logged per actor)', { in: { ...target, field: t.str() }, out: { value: t.json() }, on: ['record', '/recordId'], perm: 'records.reveal', level: 'view', risk: 'high', audit: 'always', label: 'check', errors: ['permission.provider_label'] }),
    read('records.export', 'Export rows as CSV or Excel (permissioned)', { in: { type: id.recordType, format: t.enm('csv', 'xlsx'), ...viewSpec }, out: { fileId: id.file }, on: ['record_type', '/type'], perm: 'records.export', risk: 'medium', audit: 'always', label: 'filter', tool: 'records' }),
    write('records.relate', 'Link two records through a relation field', { in: { ...target, field: t.str(), toId: id.record, unlink: t.opt(t.bool()) }, out: { record: recordRow }, on: ['record', '/recordId'], perm: 'records.edit', emits: ['record.updated'], tool: 'records', offline: 'patch' }),
    read('records.counts', 'Cached row count for a view', { in: { type: id.recordType, filter: t.opt(t.json()) }, out: { count: t.int() }, on: ['record_type', '/type'] }),
    read('records.values.pending', 'Needs review: agent-filled values waiting for a reviewer, each with its source and time (counts into My work for the field reviewer role)', {
      in: { type: id.recordType, ...pageIn }, out: { values: t.arr(pendingValue), ...pageOut }, on: ['record_type', '/type'], tool: 'records', label: 'filter',
    }),
    write('records.values.review', 'Accept or reject an agent-filled value; an accepted value counts, a rejected one is dropped and stays in history', {
      in: { ...target, field: t.str(), decision: t.enm('accept', 'reject'), note: t.opt(t.str()) }, out: { record: recordRow }, on: ['record', '/recordId'], perm: 'records.edit',
      emits: ['record.value_reviewed', 'record.updated'], tool: 'records', audit: 'sensitive',
    }),
    read('records.value_source', 'Source popover of one value: who or what filled it, from where, when, and whether it counts yet', {
      in: { ...target, field: t.str() }, out: { source: valueSource }, on: ['record', '/recordId'], tool: 'records', label: 'check',
    }),
    read('records.completeness', 'Completeness of one record (for example 8 of 11) with the missing fields; Ask for these turns the list into a short-lived form', {
      in: target, out: { filled: t.int({ minimum: 0 }), total: t.int({ minimum: 0 }), missing: t.arr(t.obj({ field: t.str(), title: t.str() })) }, on: ['record', '/recordId'], tool: 'records', label: 'check',
    }),
    write('records.gap_check', 'Run the gap-check rules of a type over one record or all of them: finds missing or stale fields and names the fill route (AI field, agent lookup, teammate task or collection form)', {
      in: { type: id.recordType, recordId: t.opt(id.record) },
      out: { gaps: t.arr(t.obj({ recordId: id.record, field: t.str(), reason: t.enm('missing', 'stale'), route: t.enm('ai_field', 'agent_lookup', 'task', 'form') })) },
      on: ['record_type', '/type'], perm: 'records.edit', emits: ['record.gaps_found'], tool: 'records',
    }),
    read('records.page_prefs.get', 'My choices on the record page of a type: sections I folded and fields I keep visible', {
      in: { type: id.recordType }, out: { folded: t.arr(t.str()), keepVisible: t.arr(t.str()) }, on: ['record_type', '/type'], tool: 'records',
    }),
    write('records.page_prefs.set', 'Fold sections and keep fields visible for myself; a personal display choice, not a Star', {
      in: { type: id.recordType, folded: t.opt(t.arr(t.str())), keepVisible: t.opt(t.arr(t.str())) }, out: { folded: t.arr(t.str()), keepVisible: t.arr(t.str()) },
      on: ['record_type', '/type'], tool: 'records', offline: 'patch',
    }),
    read('records.relations_map', 'Relationship map of a record: linked records out to two hops, each edge named by its relation field, limited to what the caller may see', {
      in: { ...target, hops: t.opt(t.int({ minimum: 1, maximum: 2 })) },
      out: { nodes: t.arr(t.obj({ recordId: id.record, type: id.recordType, title: t.str(), hop: t.int({ minimum: 0, maximum: 2 }) })), edges: t.arr(t.obj({ from: id.record, to: id.record, field: t.str() })) },
      on: ['record', '/recordId'], tool: 'records', label: 'filter',
    }),
  ],
  fieldTypes: [
    text('text', 'Text', { indexable: true }),
    ftype('longtext', 'Rich long text', t.str(), { merge: 'text-crdt', filterOps: ['contains', 'empty', 'notempty'], sortable: false, indexable: false, csv: 'text' }),
    num('number', 'Number'),
    ftype('money', 'Money', t.obj({ amount: t.int(), currency: t.str({ pattern: '^[A-Z]{3}$', examples: ['USD'] }) }), {
      storage: { columns: [{ suffix: '', sql: 'INTEGER' }, { suffix: '__cur', sql: 'TEXT' }] }, merge: 'assistant', filterOps: ['eq', 'gt', 'gte', 'lt', 'lte', 'between', 'empty', 'notempty'], csv: { codec: 'money' }, codec: 'money',
    }),
    when('datetime', 'Date and time', { csv: { codec: 'datetime' }, codec: 'datetime' }),
    ftype('duration', 'Duration', t.int({ minimum: 0 }), { storage: { columns: [{ suffix: '', sql: 'INTEGER' }] }, filterOps: ['eq', 'gt', 'lt', 'between', 'empty', 'notempty'], codec: 'duration' }),
    ftype('choice', 'Choice', t.str(), { groupable: true, filterOps: ['eq', 'ne', 'in', 'empty', 'notempty'], options: t.obj({ choices: t.arr(t.obj({ key: t.str(), title: t.str(), color: t.opt(t.str()) })) }) }),
    ftype('multichoice', 'Multi-choice', t.arr(t.str()), { storage: { columns: [{ suffix: '', sql: 'TEXT' }] }, filterOps: ['contains', 'in', 'empty', 'notempty'], sortable: false, csv: 'json', options: t.obj({ choices: t.arr(t.obj({ key: t.str(), title: t.str() })) }) }),
    ftype('status', 'Status', t.str(), { merge: 'assistant', groupable: true, filterOps: ['eq', 'ne', 'in'], options: t.obj({ stages: t.arr(t.obj({ key: t.str(), title: t.str() })) }) }),
    ftype('checkbox', 'Checkbox', t.bool(), { storage: { columns: [{ suffix: '', sql: 'INTEGER' }] }, groupable: true, filterOps: ['eq'] }),
    ftype('rating', 'Rating', t.int({ minimum: 0, maximum: 10 }), { storage: { columns: [{ suffix: '', sql: 'INTEGER' }] }, filterOps: ['eq', 'gt', 'gte', 'lt', 'lte', 'empty'] }),
    ftype('person', 'Person', t.str({ examples: ['usr_a1b2c3'] }), { merge: 'assistant', groupable: true, filterOps: ['eq', 'ne', 'in', 'empty', 'notempty'] }),
    text('email', 'Email', { codec: 'email' }),
    text('phone', 'Phone', { codec: 'phone' }),
    text('url', 'URL'),
    ftype('address', 'Address', t.obj({ line1: t.str(), line2: t.opt(t.str()), city: t.opt(t.str()), region: t.opt(t.str()), postal: t.opt(t.str()), country: t.opt(t.str()) }), { csv: 'json', filterOps: ['contains', 'empty', 'notempty'], sortable: false }),
    ftype('relation', 'Relation (two-way)', t.arr(id.record), { filterOps: ['rel_in', 'empty', 'notempty'], sortable: false, csv: 'json', options: t.obj({ target: id.recordType, inverse: t.opt(t.str()) }) }),
    ftype('lookup', 'Lookup', t.json(), { storage: { derived: 'lookup' }, filterOps: ['eq', 'contains'], options: t.obj({ via: t.str(), field: t.str() }), indexable: false }),
    ftype('rollup', 'Rollup', t.json(), { storage: { derived: 'rollup' }, filterOps: ['eq', 'gt', 'lt'], options: t.obj({ via: t.str(), field: t.str(), fn: t.enm('count', 'sum', 'min', 'max', 'avg') }), indexable: false }),
    ftype('formula', 'Formula', t.json(), { storage: { derived: 'formula' }, filterOps: ['eq', 'gt', 'lt', 'contains'], options: t.obj({ expr: t.str() }), indexable: false }),
    ftype('autonumber', 'Auto-number', t.int({ minimum: 1 }), { storage: { derived: 'auto' }, filterOps: ['eq', 'gt', 'lt', 'between'], options: t.obj({ prefix: t.opt(t.str()) }) }),
    when('created_time', 'Created time', { storage: { derived: 'auto' } }),
    ftype('created_by', 'Created by', t.str(), { storage: { derived: 'auto' }, groupable: true, filterOps: ['eq', 'in'] }),
    when('modified_time', 'Modified time', { storage: { derived: 'auto' } }),
    ftype('modified_by', 'Modified by', t.str(), { storage: { derived: 'auto' }, groupable: true, filterOps: ['eq', 'in'] }),
    ftype('files', 'Files', t.arr(id.file), { merge: 'append', filterOps: ['empty', 'notempty'], sortable: false, csv: 'json' }),
    ftype('signature', 'Signature', t.obj({ envelopeId: t.str(), state: t.enm('sent', 'viewed', 'signed', 'declined') }), { merge: 'assistant', filterOps: ['eq', 'empty', 'notempty'], csv: 'json' }),
    ftype('sealed', 'Sealed', t.obj({ sealed: t.lit(true), changed: t.opt(t.bool()) }), { sealed: true, merge: 'assistant', filterOps: ['empty', 'notempty'], sortable: false, indexable: false, csv: { codec: 'sealed' }, codec: 'sealed' }),
    ftype('button', 'Button', t.nul(), { storage: { derived: 'none' }, filterOps: [], sortable: false, indexable: false, options: t.obj({ automation: t.opt(id.automation), agent: t.opt(id.agent), label: t.str() }) }),
    ftype('ai', 'AI field', t.str(), { merge: 'assistant', filterOps: ['contains', 'empty', 'notempty'], options: t.obj({ agent: t.opt(id.agent), prompt: t.str(), review: t.bool() }) }),
  ],
  viewKinds: [
    vkind('table', 'Table', 'rows', { config: t.obj({ columns: t.arr(t.str()), colorRules: t.opt(t.json()) }) }),
    vkind('board', 'Board', 'rows', { needs: [{ fieldType: 'choice', as: 'group' }, { fieldType: 'status', as: 'group' }], config: t.obj({ group: t.str() }) }),
    vkind('calendar', 'Calendar', 'rows', { needs: [{ fieldType: 'datetime', as: 'date' }], config: t.obj({ date: t.str() }) }),
    vkind('timeline', 'Timeline', 'rows', { needs: [{ fieldType: 'datetime', as: 'start' }], config: t.obj({ start: t.str(), end: t.opt(t.str()) }) }),
    vkind('gallery', 'Gallery', 'rows', { config: t.obj({ cover: t.opt(t.str()) }) }),
    vkind('list', 'List', 'rows'),
    vkind('map', 'Map', 'rows', { needs: [{ fieldType: 'address', as: 'location' }], config: t.obj({ location: t.str() }) }),
    vkind('form', 'Form', 'rows', { config: t.obj({ form: id.form }) }),
    vkind('chart', 'Charts', 'aggregate', { config: t.obj({ kind: t.enm('bar', 'line', 'pie', 'number'), measure: t.str(), by: t.opt(t.str()) }) }),
  ],
});
