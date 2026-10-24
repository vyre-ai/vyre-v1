// schema (lane L3): record types and fields as data. describe, diff preview, apply, labels per field, CSV paste, saved views.
// Describe-it-to-an-agent has no capability of its own: the agent (or the Console assistant) drafts ops and calls schema.diff, then schema.apply on confirm.
import { defineManifest, ev, list, outward, read, screen, t, write } from '../packages/contracts/src/index.ts';
import { id, label, pageIn, pageOut } from './_common.ts';

const viewId = t.id('viw');
const fieldKey = t.str({ pattern: '^[a-z][a-z0-9_]*$', examples: ['phone'] });

const fieldDef = t.obj({
  key: fieldKey, type: t.str({ examples: ['text'] }), title: t.str(),
  label: t.opt(label), required: t.opt(t.bool()), unique: t.opt(t.bool()), default: t.opt(t.json()),
  validate: t.opt(t.obj({ expr: t.str(), message: t.str() })), lockAfter: t.opt(t.lit('approval')),
  merge: t.opt(t.enm('lww', 'assistant', 'text-crdt', 'append')), writeOnlyBy: t.opt(t.arr(t.str())), options: t.opt(t.rec()),
});

const typeDef = t.obj({
  key: id.recordType, title: t.str(), plural: t.str(), icon: t.str({ examples: ['users'] }), label,
  titleField: fieldKey, summaryField: t.opt(fieldKey), statusField: t.opt(fieldKey), ownerField: t.opt(fieldKey),
  group: t.opt(t.str()), retention: t.opt(t.str()), attribution: t.opt(t.bool()), fields: t.arr(fieldDef),
});

const typeDetail = t.obj({
  key: id.recordType, title: t.str(), plural: t.str(), icon: t.str(), label, system: t.bool(), template: t.opt(t.lit('project')),
  group: t.opt(t.str()), titleField: fieldKey, summaryField: t.opt(fieldKey), statusField: t.opt(fieldKey), ownerField: t.opt(fieldKey),
  workspace: t.opt(t.bool()), scope: t.opt(t.str({ description: "'space' or the site id for site tables" })),
  syncedFrom: t.opt(t.str({ description: 'Connector key when the type is a synced type' })),
  attribution: t.opt(t.bool()), retention: t.opt(t.str()), fields: t.arr(fieldDef), version: t.int(),
});

const typeSummary = t.obj({
  key: id.recordType, title: t.str(), plural: t.str(), icon: t.str(), group: t.opt(t.str()), label, system: t.bool(),
  syncedFrom: t.opt(t.str()), scope: t.opt(t.str()), rowCount: t.int({ minimum: 0 }), fieldCount: t.int({ minimum: 0 }),
});

const schemaOp = t.obj({
  op: t.enm('type.create', 'type.update', 'type.drop', 'field.add', 'field.update', 'field.retype', 'field.rename', 'field.drop', 'field.reorder', 'relation.add', 'relation.drop'),
  type: id.recordType,
  field: t.opt(fieldKey),
  def: t.opt(t.rec()),
  newKey: t.opt(t.str()),
  toType: t.opt(t.str({ description: 'New field type key for field.retype' })),
  order: t.opt(t.arr(fieldKey)),
});

const diffItem = t.obj({
  itemKey: t.str({ description: 'Stable key of one change, used to confirm destructive items', examples: ['field.drop:contact.phone'] }),
  op: t.str(), type: id.recordType, field: t.opt(fieldKey), summary: t.str(),
  destructive: t.bool(), affectedRows: t.int({ minimum: 0 }), copiedToTrash: t.bool(),
});

const viewRow = t.obj({
  viewId, type: id.recordType, kind: t.str({ examples: ['table'] }), title: t.str(), shared: t.bool(), ownerId: t.str(),
  filter: t.opt(t.json()), sort: t.opt(t.json()), group: t.opt(t.str()), hidden: t.opt(t.arr(t.str())),
  colorRules: t.opt(t.json()), config: t.opt(t.rec()), updatedAt: t.ts(),
});

const section = t.opt(t.enm('personal', 'shared', 'space'));

const layoutSection = t.obj({ key: t.str({ examples: ['contact_details'] }), title: t.str(), fields: t.arr(fieldKey), folded: t.opt(t.bool()) });
const gapRule = t.obj({
  ruleId: t.str({ examples: ['gap_missing_email'] }), field: fieldKey, when: t.enm('missing', 'stale'), staleAfterDays: t.opt(t.int({ minimum: 1 })),
  route: t.enm('ai_field', 'agent_lookup', 'task', 'form'), agentId: t.opt(id.agent), enabled: t.bool(),
});

export default defineManifest({
  id: 'schema',
  title: 'Schema',
  owner: 'L3',
  lists: [list('record_type', 'Record type', 'Record types', 'schema.types.list')],
  events: [
    ev('schema.changed', 'A record type or field changed (add, edit, retype, label, drop)', {
      p: { changeId: t.id('sch'), type: id.recordType, types: t.arr(id.recordType), ops: t.arr(t.obj({ op: t.str(), type: id.recordType, field: t.opt(t.str()) })), destructive: t.bool() },
      subject: ['record_type', '/type'], label: 'internal', trigger: { title: 'A record type or field changes', fields: ['/type'] },
    }),
    ev('schema.type_dropped', 'A record type was dropped (copy kept in Trash for 30 days)', { p: { type: id.recordType, changeId: t.id('sch') }, subject: ['record_type', '/type'], retention: 'trash' }),
    ev('schema.field_restored', 'A dropped field came back from Trash', { p: { type: id.recordType, field: fieldKey }, subject: ['record_type', '/type'] }),
    ev('schema.label_changed', 'The sensitivity label of a type or field changed', { p: { type: id.recordType, field: t.opt(fieldKey), from: label, to: label }, subject: ['record_type', '/type'] }),
    ev('view.saved', 'A saved view was created or changed', { p: { viewId, type: id.recordType, shared: t.bool() }, subject: ['record_type', '/type'] }),
    ev('view.published', 'A saved view became shared or personal again', { p: { viewId, type: id.recordType, shared: t.bool() }, subject: ['record_type', '/type'] }),
    ev('view.deleted', 'A saved view was deleted', { p: { viewId, type: id.recordType }, subject: ['record_type', '/type'] }),
  ],
  capabilities: [
    read('schema.describe', 'Describe one record type or all of them: fields, field types, options, labels, relations', {
      in: { type: t.opt(id.recordType) }, out: { types: t.arr(typeDetail) }, tool: 'records', label: 'filter', cli: 'vyre schema describe',
    }),
    read('schema.types.list', 'List record types in Personal, Shared with me or Space sections with folders and counts', {
      in: { section, folder: t.opt(id.folder), group: t.opt(t.str()), ...pageIn }, out: { types: t.arr(typeSummary), ...pageOut },
      tool: 'records', label: 'filter',
    }),
    read('schema.types.get', 'Read one record type with every field', { in: { type: id.recordType }, out: { type: typeDetail }, on: ['record_type', '/type'], tool: 'records', label: 'check' }),
    read('schema.map', 'The Schema map: record types as nodes and relations as edges, two hops from a type if given', {
      in: { type: t.opt(id.recordType), hops: t.opt(t.int({ minimum: 1, maximum: 3 })) },
      out: { nodes: t.arr(t.obj({ type: id.recordType, title: t.str(), rowCount: t.int() })), edges: t.arr(t.obj({ from: id.recordType, to: id.recordType, field: fieldKey, inverse: t.opt(fieldKey) })) },
      tool: 'records', label: 'filter',
    }),
    read('schema.field_types', 'Catalogue of field types with their filter operators and options', {
      out: { fieldTypes: t.arr(t.obj({ key: t.str(), title: t.str(), filterOps: t.arr(t.str()), sortable: t.bool(), groupable: t.bool(), sealed: t.bool() })) }, tool: 'records',
    }),
    read('schema.view_kinds', 'Catalogue of view kinds and which field types each needs', {
      out: { viewKinds: t.arr(t.obj({ key: t.str(), title: t.str(), needs: t.arr(t.obj({ fieldType: t.str(), as: t.str() })) })) }, tool: 'records',
    }),
    read('schema.diff', 'Preview a set of schema changes as a diff: what is added, what is destructive, rows affected, and a preview token', {
      in: { ops: t.arr(schemaOp, { minItems: 1 }) },
      out: { previewToken: t.str(), items: t.arr(diffItem), additive: t.int(), destructive: t.int(), problems: t.arr(t.obj({ itemKey: t.str(), message: t.str() })) },
      perm: 'schema.manage', tool: 'engineer', cli: 'vyre schema diff',
    }),
    write('schema.apply', 'Apply schema changes. Additions go straight through; destructive items (delete or retype a field, drop a type) must be listed in confirm', {
      in: { ops: t.arr(schemaOp, { minItems: 1 }), previewToken: t.opt(t.str()), confirm: t.opt(t.arr(t.str(), { description: 'itemKeys of destructive items the person confirmed' })), reason: t.opt(t.str()) },
      out: { changeId: t.id('sch'), applied: t.int(), items: t.arr(diffItem) },
      perm: 'schema.manage', idem: 'key', audit: 'always', emits: ['schema.changed', 'schema.type_dropped'], tool: 'engineer', cli: 'vyre schema apply',
      agent: { planMode: 'blocked' }, errors: ['validation.precondition_failed', 'validation.duplicate', 'permission.on_hold'],
    }),
    write('schema.set_label', 'Set the sensitivity label of a record type or of one field', {
      in: { type: id.recordType, field: t.opt(fieldKey), label }, out: { ok: t.bool() },
      on: ['record_type', '/type'], perm: 'schema.manage', audit: 'always', emits: ['schema.label_changed', 'schema.changed'], tool: 'engineer',
    }),
    read('schema.infer', 'Propose a record type from pasted CSV text or a CSV/XLSX file: field names, types, choices and a title field', {
      in: { text: t.opt(t.str()), fileId: t.opt(id.file), name: t.opt(t.str()), sheet: t.opt(t.str()) },
      out: { ops: t.arr(schemaOp), columns: t.arr(t.obj({ column: t.str(), field: fieldKey, type: t.str(), sample: t.arr(t.str()) })), rowCount: t.int() },
      perm: 'schema.manage', tool: 'engineer', cli: 'vyre schema infer',
    }),
    read('schema.changes.list', 'History of schema changes with who and why', {
      in: { type: t.opt(id.recordType), since: t.opt(t.ts()), ...pageIn },
      out: { changes: t.arr(t.obj({ changeId: t.id('sch'), at: t.ts(), by: t.str(), summary: t.str(), destructive: t.bool(), types: t.arr(id.recordType) })), ...pageOut },
      tool: 'records',
    }),
    read('schema.trash.list', 'Dropped fields and types still held in Trash (30 days)', {
      out: { items: t.arr(t.obj({ type: id.recordType, field: t.opt(fieldKey), droppedAt: t.ts(), expiresAt: t.ts(), rows: t.int() })) }, perm: 'schema.manage', tool: 'engineer',
    }),
    write('schema.restore_field', 'Bring a dropped field back from Trash with its values', {
      in: { type: id.recordType, field: fieldKey }, out: { ok: t.bool() }, on: ['record_type', '/type'], perm: 'schema.manage',
      audit: 'always', emits: ['schema.field_restored', 'schema.changed'], tool: 'engineer',
    }),
    // Saved views: filter, sort, group, hidden fields, colour rules; personal or shared.
    read('views.list', 'List saved views of a record type that the caller may see', {
      in: { type: id.recordType, kind: t.opt(t.str()) }, out: { views: t.arr(viewRow) }, on: ['record_type', '/type'], tool: 'records',
    }),
    read('views.get', 'Read one saved view', { in: { viewId }, out: { view: viewRow }, tool: 'records' }),
    write('views.save', 'Create or change a saved view (personal until published)', {
      in: {
        type: id.recordType, viewId: t.opt(viewId), kind: t.str({ examples: ['table'] }), title: t.str(),
        filter: t.opt(t.json()), sort: t.opt(t.json()), group: t.opt(t.str()), hidden: t.opt(t.arr(t.str())),
        colorRules: t.opt(t.json()), config: t.opt(t.rec()),
      },
      out: { view: viewRow }, on: ['record_type', '/type'], level: 'view', idem: 'key', emits: ['view.saved'], tool: 'records', offline: 'queue',
    }),
    write('views.publish', 'Share a saved view with everyone who can read the type, or make it personal again', {
      in: { viewId, shared: t.bool() }, out: { view: viewRow }, perm: 'schema.manage', emits: ['view.published'], tool: 'records',
    }),
    write('views.delete', 'Delete a saved view', { in: { viewId }, out: { deleted: t.bool() }, emits: ['view.deleted'], level: 'view', tool: 'records' }),
    outward('views.share_external', 'Make a read-only link to a saved view for a client', {
      in: { viewId, expiresAt: t.opt(t.ts()) }, out: { url: t.str(), expiresAt: t.opt(t.ts()) },
      perm: 'records.share_external', level: 'manage', gate: { act: 'send', when: "actor.kind != 'person'" }, tool: 'records',
    }),
    read('schema.layout.get', 'Admin layout of the record page of a type: ordered sections with their fields and which start folded', {
      in: { type: id.recordType }, out: { sections: t.arr(layoutSection) }, on: ['record_type', '/type'], tool: 'records',
    }),
    write('schema.layout.set', 'Set the record page layout of a type (sections, order, default folds); people fold and keep fields visible on top of it for themselves', {
      in: { type: id.recordType, sections: t.arr(layoutSection) }, out: { sections: t.arr(layoutSection) }, on: ['record_type', '/type'], perm: 'schema.manage',
      emits: ['schema.changed'], audit: 'always', tool: 'engineer',
    }),
    read('schema.gap_rules.list', 'Gap-check rules of a type: which fields count as missing or stale and how each gap is routed', {
      in: { type: id.recordType }, out: { rules: t.arr(gapRule) }, on: ['record_type', '/type'], tool: 'records',
    }),
    write('schema.gap_rules.set', 'Create or replace a gap-check rule: a missing or stale field goes to an AI field, an agent lookup, a teammate task or a collection form', {
      in: { type: id.recordType, rule: gapRule }, out: { rule: gapRule }, on: ['record_type', '/type'], perm: 'schema.manage', emits: ['schema.changed'], audit: 'always', tool: 'engineer',
    }),
    read('schema.sensitivity.scan', 'Detect sensitive data in the fields of a type (ID numbers, card and bank numbers, health terms) and suggest which fields to seal; changes nothing and returns no values', {
      in: { type: id.recordType },
      out: { suggestions: t.arr(t.obj({ field: fieldKey, kind: t.enm('id_number', 'card', 'bank', 'health', 'other'), matches: t.int({ minimum: 0 }), suggestedLabel: label, seal: t.bool() })) },
      on: ['record_type', '/type'], perm: 'schema.manage', tool: 'engineer', label: 'filter',
    }),
  ],
  screens: [
    screen('records.types', 'records', 'ui:RecordTypesList', {
      q: { types: ['schema.types.list', { section: '/state/section', folder: '/state/folder' }] }, empty: 'No record types yet',
    }),
    screen('records.schema-map', 'records', 'ui:SchemaMap', {
      q: { map: ['schema.map', { type: '/state/type' }] }, empty: 'No relations yet',
    }),
    screen('records.saved-views', 'records', 'ui:SavedViews', {
      slot: 'sidebar',
      q: { views: ['views.list', { type: '/state/type' }] },
      a: { save: ['views.save', { type: '/state/type', kind: '/draft/kind', title: '/draft/title' }], publish: ['views.publish', { viewId: '/state/viewId', shared: '/draft/shared' }], remove: ['views.delete', { viewId: '/state/viewId' }, 'Delete this view?'] },
      empty: 'No saved views',
    }),
    screen('console.schema', 'console', 'ui:ConsoleSchema', {
      q: { types: ['schema.describe', { type: '/state/type' }], changes: ['schema.changes.list', { type: '/state/type' }], trash: ['schema.trash.list'] },
      a: {
        diff: ['schema.diff', { ops: '/draft/ops' }],
        apply: ['schema.apply', { ops: '/draft/ops', previewToken: '/draft/previewToken', confirm: '/draft/confirm' }, 'Apply these changes?'],
        infer: ['schema.infer', { text: '/draft/csv', fileId: '/draft/fileId' }],
        label: ['schema.set_label', { type: '/state/type', field: '/state/field', label: '/draft/label' }],
        restore: ['schema.restore_field', { type: '/state/type', field: '/state/field' }],
      },
      needs: ['schema.manage'], empty: 'No record types yet', primary: 'New record type',
    }),
  ],
});
