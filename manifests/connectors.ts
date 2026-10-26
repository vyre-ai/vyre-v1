// connectors (lane L3): the connector framework (build, test, run, publish), Connections, synced types and the sync engine (spec 2.10, architecture 4.3.1 and section 8).
// The sync engine is one engine over any RecordStore: a Run kind 'connector_sync' with outbox, idempotency, stored replaced values (undo of pushes) and dry-run preview.
// DECISION: the built-in HubSpot connector is a connector.toml compiled by the generator (connectors/hubspot), not declared in this file.
// DECISION: sync_types.create needs connectors.manage; making the local record type is done through schema.apply by the same call and also needs schema.manage (checked in the handler).
// DECISION: sync.conflict is declared here because the sync engine emits it; the conflicts module reads it into its conflict entity and must not declare it again.
import { create, defineManifest, ev, health, outward, read, screen, setting, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut, runStarted } from './_common.ts';

const syncTypeId = t.id('syt');
const outboxId = t.id('obx');
const draftId = t.id('cdr');
const conflictId = id.conflict;
const fieldKey = t.str({ pattern: '^[a-z][a-z0-9_]*$', examples: ['email'] });
const mode = t.enm('api', 'mcp', 'dwd', 'oauth_app', 'webhook_only');
const dir = t.enm('pull', 'push', 'both', 'off');
const deletes = t.enm('off', 'soft', 'travel');
const conflictRule = t.enm('newest', 'source', 'vyre', 'ask');

const fieldMap = t.obj({ key: fieldKey, remote: t.str(), dir, transform: t.opt(t.str({ description: 'Small expression over the value' })) });
const polling = t.obj({ activeSec: t.int({ minimum: 30 }), idleSec: t.int({ minimum: 60 }), dormantSec: t.int({ minimum: 300 }) });

/** The action names a connector uses to sync one object; a name left out keeps the convention list_<objects>, list_<objects>_after, create_<object>, update_<object>, delete_<object>. */
const objectActions = t.obj({
  list: t.opt(t.str()), listAfter: t.opt(t.str({ description: 'List the next page; takes { after }' })), create: t.opt(t.str()), update: t.opt(t.str()), delete: t.opt(t.str()),
});

const connectorRow = t.obj({
  key: id.connector, title: t.str(), mode, scope: t.enm('person', 'space'), builtin: t.bool(), version: t.str({ examples: ['1.0.0'] }),
  state: t.enm('live', 'draft', 'failing_tests'), domains: t.arr(t.str()), secrets: t.arr(t.obj({ name: t.str(), description: t.str() })),
  connections: t.int({ minimum: 0 }), syncedTypes: t.arr(t.str()), actions: t.arr(t.str()), sources: t.arr(t.str()),
  objects: t.opt(t.rec(objectActions)),
});

const connectionRow = t.obj({
  connectionId: id.connection, connector: id.connector, title: t.str(),
  owner: t.obj({ kind: t.enm('person', 'space'), id: t.str() }),
  state: t.enm('pending', 'active', 'paused', 'needs_reconnect', 'failing'), pausedBy: t.opt(t.str()),
  scopes: t.arr(t.str()), lastSyncAt: t.opt(t.ts()), createdAt: t.ts(),
});

const syncedTypeRow = t.obj({
  syncTypeId, type: id.recordType, connector: id.connector, connectionId: id.connection, remote: t.str(),
  state: t.enm('initial', 'syncing', 'paused', 'needs_review', 'error'),
  fields: t.arr(fieldMap), match: t.arr(fieldKey), createAtSource: t.bool(), deletes, conflict: conflictRule, polling, nightlyReconcile: t.bool(),
  lastSyncAt: t.opt(t.ts()), pending: t.int({ minimum: 0 }), conflicts: t.int({ minimum: 0 }), schemaChanges: t.int({ minimum: 0 }),
});

const bindingIn = {
  type: id.recordType, connectionId: id.connection, remote: t.str({ examples: ['contacts'] }),
  fields: t.arr(fieldMap), match: t.arr(fieldKey), createAtSource: t.opt(t.bool()), deletes: t.opt(deletes), conflict: t.opt(conflictRule),
  polling: t.opt(polling), nightlyReconcile: t.opt(t.bool()),
};

const testResult = t.obj({ passed: t.int(), failed: t.int(), cases: t.arr(t.obj({ name: t.str(), ok: t.bool(), message: t.opt(t.str()) })) });

const outboxRow = t.obj({
  outboxId, syncTypeId, recordId: id.record, op: t.enm('create', 'update', 'delete'), fields: t.arr(fieldKey),
  state: t.enm('pending', 'sent', 'failed', 'canceled', 'undone'), attempts: t.int(), idempotencyKey: t.str(), error: t.opt(t.str()), at: t.ts(),
});

const previewOut = {
  creates: t.int(), updates: t.int(), removes: t.int(), skips: t.int(),
  summary: t.str({ examples: ['Will update 34 records in HubSpot'] }),
  matches: t.opt(t.obj({ sure: t.int(), unsure: t.int(), none: t.int() })),
  samples: t.arr(t.obj({ recordId: t.opt(id.record), remoteId: t.opt(t.str()), op: t.str(), changes: t.rec() })),
};

export default defineManifest({
  id: 'connectors',
  title: 'Connectors and synced types',
  owner: 'L3',
  settings: [
    setting('connectors.delete_guard', 'space', 'integrations', 'Pause and ask when records vanish at the source', t.obj({ percent: t.int({ minimum: 1, maximum: 100 }), count: t.int({ minimum: 1 }) }), { percent: 10, count: 50 }),
    setting('connectors.polling', 'space', 'integrations', 'Polling intervals when webhooks are not available', polling, { activeSec: 120, idleSec: 900, dormantSec: 3600 }),
    setting('connectors.conflict_default', 'space', 'integrations', 'Default conflict rule for two-way fields', conflictRule, 'newest'),
  ],
  events: [
    ev('sync.completed', 'A sync run finished', {
      p: { runId: id.run, syncTypeId, type: id.recordType, connector: id.connector, mode: t.str(), pulled: t.int(), pushed: t.int(), created: t.int(), updated: t.int(), removed: t.int() },
      subject: ['entity', '/syncTypeId'], trigger: { title: 'A sync finishes', fields: ['/type', '/connector'] },
    }),
    ev('sync.conflict', 'Both sides changed the same field and the rule asks a person (values are not in the payload)', {
      p: { conflictId, syncTypeId, type: id.recordType, recordId: id.record, field: fieldKey, rule: conflictRule },
      subject: ['record', '/recordId'], label: 'subject', trigger: { title: 'A sync conflict appears', fields: ['/type'] }, notify: 'conflict.needs_you',
    }),
    ev('sync.push_failed', 'A change could not be written to the remote app after retries', {
      p: { syncTypeId, type: id.recordType, recordId: id.record, outboxId, error: t.str(), attempts: t.int() },
      subject: ['record', '/recordId'], label: 'subject', trigger: { title: 'A sync push fails', fields: ['/type'] }, notify: 'sync.attention', replay: 'stub',
    }),
    ev('sync.pushed', 'A change was written to the remote app', { p: { syncTypeId, recordId: id.record, outboxId }, subject: ['record', '/recordId'], label: 'subject', replay: 'stub' }),
    ev('sync.push_undone', 'A push was reversed with the stored replaced value', { p: { syncTypeId, recordId: id.record, outboxId }, subject: ['record', '/recordId'], label: 'subject', replay: 'stub' }),
    ev('sync.deletes_paused', 'More than the guard allows vanished at the source; sync waits for a person', { p: { syncTypeId, type: id.recordType, count: t.int(), percent: t.num() }, subject: ['entity', '/syncTypeId'], notify: 'sync.attention' }),
    ev('sync.schema_changed', 'The remote schema changed and needs review', { p: { syncTypeId, type: id.recordType, changes: t.int() }, subject: ['entity', '/syncTypeId'], notify: 'sync.attention' }),
    ev('sync.type_bound', 'A record type was bound to a remote object', { p: { syncTypeId, type: id.recordType, connector: id.connector }, subject: ['entity', '/syncTypeId'] }),
    ev('sync.type_updated', 'Mapping, direction or rules of a synced type changed', { p: { syncTypeId, fields: t.arr(t.str()) }, subject: ['entity', '/syncTypeId'] }),
    ev('sync.type_paused', 'Sync of a type was paused', { p: { syncTypeId }, subject: ['entity', '/syncTypeId'] }),
    ev('sync.type_resumed', 'Sync of a type was resumed', { p: { syncTypeId }, subject: ['entity', '/syncTypeId'] }),
    ev('sync.type_native', 'A synced type was detached and kept as a native type with its ids, history and attribution', { p: { syncTypeId, type: id.recordType }, subject: ['record_type', '/type'] }),
    ev('connection.created', 'A connection was made', { p: { connectionId: id.connection, connector: id.connector, ownerKind: t.enm('person', 'space') }, subject: ['connection', '/connectionId'] }),
    ev('connection.paused', 'The owner paused a connection', { p: { connectionId: id.connection }, subject: ['connection', '/connectionId'] }),
    ev('connection.resumed', 'A paused connection resumed', { p: { connectionId: id.connection }, subject: ['connection', '/connectionId'] }),
    ev('connection.needs_reconnect', 'The provider rejected the sign-in; the owner must reconnect', { p: { connectionId: id.connection, connector: id.connector }, subject: ['connection', '/connectionId'], notify: 'sync.attention' }),
    ev('connection.reconnected', 'A connection signed in again', { p: { connectionId: id.connection }, subject: ['connection', '/connectionId'] }),
    ev('connection.deleted', 'A connection was removed', { p: { connectionId: id.connection, connector: id.connector }, subject: ['connection', '/connectionId'] }),
    ev('connector.created', 'A connector folder was scaffolded', { p: { key: id.connector }, subject: ['connector', '/key'] }),
    ev('connector.built', 'The build-connector flow produced a draft', { p: { key: id.connector, draftId }, subject: ['connector', '/key'] }),
    ev('connector.published', 'A connector version went live after a fresh passing test run', { p: { key: id.connector, version: t.str(), tests: t.int() }, subject: ['connector', '/key'] }),
    ev('connector.publish_failed', 'Publish was refused because tests failed; the last good version stays live', { p: { key: id.connector, failed: t.int() }, subject: ['connector', '/key'], notify: 'sync.attention' }),
    ev('connector.rolled_back', 'A connector went back to an earlier version', { p: { key: id.connector, version: t.str() }, subject: ['connector', '/key'] }),
    ev('connector.removed', 'A connector was removed', { p: { key: id.connector }, subject: ['connector', '/key'] }),
  ],
  capabilities: [
    // ---- connector framework
    read('connectors.list', 'List connectors: built-in, installed and drafts', { in: { state: t.opt(t.enm('live', 'draft', 'failing_tests')), ...pageIn }, out: { connectors: t.arr(connectorRow), ...pageOut }, perm: 'connectors.manage', tool: 'engineer', cli: 'vyre connector list' }),
    read('connectors.get', 'Read one connector: auth, egress domains, secret names, sources, synced types and actions', { in: { key: id.connector }, out: { connector: connectorRow }, on: ['connector', '/key'], tool: 'engineer' }),
    create('connectors.init', 'Scaffold a connector folder: connector.toml, transforms.js, tests, README', {
      in: { key: id.connector, title: t.str(), mode, docsUrl: t.opt(t.str()) }, out: { key: id.connector, folderId: id.folder }, make: ['connector', '/key'],
      perm: 'connectors.manage', emits: ['connector.created'], audit: 'always', tool: 'engineer', cli: 'vyre connector init',
    }),
    write('connectors.build', 'Run the build-connector flow: read the app docs, draft the connector, ask for a key through a Vault request, run the harness', {
      in: { key: id.connector, docsUrl: t.opt(t.str()), notes: t.opt(t.str()) }, out: { ...runStarted, draftId },
      on: ['connector', '/key'], perm: 'connectors.manage', idem: 'key', run: { kind: 'connector_build', stoppable: true }, emits: ['connector.built'], tool: 'engineer', cli: 'vyre connector build',
    }),
    read('connectors.test', 'Run the harness on recorded responses and report each case', {
      in: { key: id.connector, draftId: t.opt(draftId) }, out: { result: testResult }, on: ['connector', '/key'], perm: 'connectors.manage', tool: 'engineer', cli: 'vyre connector test',
    }),
    outward('connectors.run', 'Run one connector action against the live app, sandboxed to the connector domains, with a dry run option', {
      in: { key: id.connector, action: t.str(), connectionId: id.connection, input: t.json(), dryRun: t.opt(t.bool()) }, out: { output: t.json(), dryRun: t.bool() },
      on: ['connector', '/key'], perm: 'connectors.manage', gate: { act: 'send', when: "actor.kind != 'person'" }, emits: ['connection.needs_reconnect'], tool: 'engineer', cli: 'vyre connector run',
    }),
    read('connectors.diff', 'Diff a draft against the live version of a connector', {
      in: { key: id.connector, draftId: t.opt(draftId) }, out: { files: t.arr(t.obj({ path: t.str(), added: t.int(), removed: t.int() })), breaking: t.bool() }, on: ['connector', '/key'], perm: 'connectors.manage', tool: 'engineer',
    }),
    write('connectors.publish', 'Publish a draft after a fresh test run; a failing test keeps the last good version live', {
      in: { key: id.connector, draftId: t.opt(draftId), note: t.opt(t.str()) }, out: { published: t.bool(), version: t.opt(t.str()), result: testResult },
      on: ['connector', '/key'], perm: 'connectors.manage', idem: 'key', audit: 'always', emits: ['connector.published', 'connector.publish_failed'], tool: 'engineer', cli: 'vyre connector publish',
    }),
    read('connectors.versions', 'List published versions of a connector', { in: { key: id.connector }, out: { versions: t.arr(t.obj({ version: t.str(), at: t.ts(), by: t.str(), note: t.opt(t.str()), tests: t.int() })) }, on: ['connector', '/key'], perm: 'connectors.manage', tool: 'engineer' }),
    write('connectors.rollback', 'Put an earlier connector version back live', {
      in: { key: id.connector, version: t.str() }, out: { ok: t.bool() }, on: ['connector', '/key'], perm: 'connectors.manage', audit: 'always', emits: ['connector.rolled_back'], tool: 'engineer',
    }),
    read('connectors.export', 'Export a connector as a folder in Files (no public gallery in v1)', { in: { key: id.connector }, out: { folderId: id.folder }, on: ['connector', '/key'], perm: 'connectors.manage', tool: 'engineer', cli: 'vyre connector export' }),
    write('connectors.remove', 'Remove a connector and its connections', { in: { key: id.connector }, out: { removed: t.bool() }, on: ['connector', '/key'], perm: 'connectors.manage', audit: 'always', emits: ['connector.removed', 'connection.deleted'], tool: 'engineer', errors: ['validation.precondition_failed'] }),
    read('connectors.health', 'Aggregate state of connections and sync lag', {
      out: { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()), failing: t.arr(id.connection) },
    }),
    // ---- connections
    read('connections.list', 'List connections; mine, the Space ones or all the caller may see', {
      in: { connector: t.opt(id.connector), whose: t.opt(t.enm('mine', 'space', 'all')), ...pageIn }, out: { connections: t.arr(connectionRow), ...pageOut }, tool: 'engineer', label: 'filter',
    }),
    read('connections.get', 'Read one connection', { in: { connectionId: id.connection }, out: { connection: connectionRow }, on: ['connection', '/connectionId'], tool: 'engineer' }),
    create('connections.create', 'Plug an account into a connector; secrets are named Vault items, never values', {
      in: { connector: id.connector, title: t.str(), ownerKind: t.enm('person', 'space'), secrets: t.opt(t.rec(id.handle)), scopes: t.opt(t.arr(t.str())) },
      out: { connection: connectionRow, authUrl: t.opt(t.str()) }, make: ['connection', '/connector'], perm: 'connectors.manage', emits: ['connection.created'], audit: 'always', tool: 'engineer',
    }),
    write('connections.update', 'Rename a connection or change its scopes', { in: { connectionId: id.connection, title: t.opt(t.str()), scopes: t.opt(t.arr(t.str())) }, out: { connection: connectionRow }, on: ['connection', '/connectionId'], level: 'manage', tool: 'engineer' }),
    write('connections.pause', 'The owner pauses a connection; syncing and actions stop', { in: { connectionId: id.connection }, out: { ok: t.bool() }, on: ['connection', '/connectionId'], level: 'manage', emits: ['connection.paused'], tool: 'engineer' }),
    write('connections.resume', 'The owner resumes a connection', { in: { connectionId: id.connection }, out: { ok: t.bool() }, on: ['connection', '/connectionId'], level: 'manage', emits: ['connection.resumed'], tool: 'engineer' }),
    write('connections.reconnect', 'Start signing in again; returns the provider sign-in address when one is needed', { in: { connectionId: id.connection }, out: { authUrl: t.opt(t.str()) }, on: ['connection', '/connectionId'], level: 'manage', tool: 'engineer' }),
    write('connections.complete_auth', 'Finish an OAuth sign-in from the callback (state and code)', {
      in: { state: t.str(), code: t.str() }, out: { connectionId: id.connection }, level: 'use', emits: ['connection.reconnected', 'connection.created'], errors: ['auth.invalid_code', 'provider.auth_failed'], offline: 'online',
    }),
    read('connections.test', 'Probe a connection with the connector health call', { in: { connectionId: id.connection }, out: { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()) }, on: ['connection', '/connectionId'], emits: ['connection.needs_reconnect'], tool: 'engineer' }),
    write('connections.delete', 'Remove a connection; synced types bound to it pause', { in: { connectionId: id.connection }, out: { deleted: t.bool() }, on: ['connection', '/connectionId'], level: 'manage', audit: 'always', emits: ['connection.deleted'], tool: 'engineer' }),
    // ---- synced types
    read('sync_types.list', 'List synced types with state, pending pushes, conflicts and schema changes', { in: { connector: t.opt(id.connector), ...pageIn }, out: { syncedTypes: t.arr(syncedTypeRow), ...pageOut }, tool: 'records', label: 'filter' }),
    read('sync_types.get', 'Read the sync binding of a record type (the header line, mapping and rules)', { in: { type: id.recordType }, out: { syncedType: syncedTypeRow }, on: ['record_type', '/type'], tool: 'records', label: 'check' }),
    read('sync_types.discover', 'List remote objects and their fields with a proposed record type and mapping', {
      in: { connectionId: id.connection, remote: t.opt(t.str()) },
      out: { objects: t.arr(t.obj({ remote: t.str(), title: t.str(), fields: t.arr(t.obj({ remote: t.str(), type: t.str(), proposedKey: fieldKey, proposedType: t.str(), sensitive: t.bool() })) })) },
      on: ['connection', '/connectionId'], perm: 'connectors.manage', emits: ['connection.needs_reconnect'], tool: 'engineer',
    }),
    write('sync_types.create', 'Bind a record type (new or existing) to a remote object with field directions, match rule and conflict rule', {
      in: bindingIn, out: { syncedType: syncedTypeRow }, perm: 'connectors.manage', idem: 'key', audit: 'always', emits: ['sync.type_bound', 'schema.changed'], tool: 'engineer', errors: ['validation.duplicate'],
    }),
    write('sync_types.update', 'Change field directions, transforms, match, create-at-source, deletes, conflict rule or polling', {
      in: { type: id.recordType, fields: t.opt(t.arr(fieldMap)), match: t.opt(t.arr(fieldKey)), createAtSource: t.opt(t.bool()), deletes: t.opt(deletes), conflict: t.opt(conflictRule), polling: t.opt(polling), nightlyReconcile: t.opt(t.bool()) },
      out: { syncedType: syncedTypeRow }, on: ['record_type', '/type'], perm: 'connectors.manage', audit: 'always', emits: ['sync.type_updated'], tool: 'records',
    }),
    read('sync_types.preview', 'Dry run: what a sync would do, such as will update 34 records in HubSpot, and the first-sync match counts', {
      in: { type: id.recordType, direction: t.opt(t.enm('pull', 'push', 'both')) }, out: previewOut, on: ['record_type', '/type'], perm: 'connectors.manage', tool: 'records',
    }),
    write('sync_types.pause', 'Pause sync of a type', { in: { type: id.recordType }, out: { ok: t.bool() }, on: ['record_type', '/type'], perm: 'connectors.manage', emits: ['sync.type_paused'], tool: 'records' }),
    write('sync_types.resume', 'Resume sync of a type', { in: { type: id.recordType }, out: { ok: t.bool() }, on: ['record_type', '/type'], perm: 'connectors.manage', emits: ['sync.type_resumed'], tool: 'records' }),
    read('sync_types.log', 'Sync log: runs, pulls and pushes under one trace id each', {
      in: { type: id.recordType, ...pageIn },
      out: { entries: t.arr(t.obj({ at: t.ts(), kind: t.enm('pull', 'push', 'conflict', 'error', 'schema'), summary: t.str(), runId: t.opt(id.run), traceId: t.opt(id.trace) })), ...pageOut },
      on: ['record_type', '/type'], perm: 'connectors.manage', tool: 'records',
    }),
    read('sync_types.schema_changes', 'Remote schema changes waiting for review (for example 3 changes to review)', {
      in: { type: id.recordType }, out: { changes: t.arr(t.obj({ changeKey: t.str(), kind: t.enm('field_added', 'field_removed', 'field_retyped', 'object_removed'), remote: t.str(), summary: t.str() })) },
      on: ['record_type', '/type'], perm: 'connectors.manage', tool: 'records',
    }),
    write('sync_types.review_schema', 'Accept or ignore remote schema changes; accepted ones go through schema.apply', {
      in: { type: id.recordType, accept: t.arr(t.str()), ignore: t.arr(t.str()) }, out: { accepted: t.int(), ignored: t.int() }, on: ['record_type', '/type'], perm: 'connectors.manage', emits: ['sync.type_updated', 'schema.changed'], tool: 'records',
    }),
    write('sync_types.confirm_deletes', 'Decide what happens when many records vanished at the source: mark them removed or keep them', {
      in: { type: id.recordType, decision: t.enm('mark_removed', 'keep') }, out: { removed: t.int() }, on: ['record_type', '/type'], perm: 'connectors.manage', audit: 'always', emits: ['sync.type_updated'], tool: 'records',
    }),
    write('sync_types.make_native', 'Detach a synced type and keep it as a native type with its ids, history and attribution', {
      in: { type: id.recordType }, out: { ok: t.bool() }, on: ['record_type', '/type'], perm: 'connectors.manage', audit: 'always', emits: ['sync.type_native'], tool: 'records', agent: { planMode: 'blocked' },
    }),
    write('sync_types.resolve_conflict', 'Settle a sync conflict: keep ours, take theirs, or enter a value', {
      in: { conflictId, resolution: t.enm('ours', 'theirs', 'value'), value: t.opt(t.json()) }, out: { recordId: id.record }, perm: 'records.edit', idem: 'key', emits: ['record.updated'], tool: 'records',
    }),
    read('sync_types.replay_conflict', 'Replay a conflict on a copy to see what each rule would have produced', {
      in: { conflictId }, out: { results: t.arr(t.obj({ rule: conflictRule, value: t.json() })) }, tool: 'records',
    }),
    outward('sync_types.undo_push', 'Reverse one push using the stored replaced value', {
      in: { outboxId }, out: { ok: t.bool() }, perm: 'records.edit', emits: ['sync.push_undone'], gate: { act: 'send', when: "actor.kind != 'person'" }, tool: 'records',
    }),
    // ---- sync engine
    write('connectors.sync_now', 'Start a sync Run for a synced type or a connection; modes: incremental, reconcile, backfill, dry_run', {
      in: { syncTypeId: t.opt(syncTypeId), type: t.opt(id.recordType), connectionId: t.opt(id.connection), mode: t.opt(t.enm('incremental', 'reconcile', 'backfill', 'dry_run')), runAutomations: t.opt(t.bool()) },
      out: runStarted, run: { kind: 'connector_sync', stoppable: true }, perm: null, idem: 'key', emits: ['sync.completed', 'sync.conflict', 'sync.deletes_paused', 'sync.schema_changed', 'record.updated'], tool: 'records', offline: 'online',
    }),
    read('connectors.outbox.list', 'Pending, failed and recent pushes with their idempotency keys', {
      in: { type: t.opt(id.recordType), state: t.opt(t.enm('pending', 'sent', 'failed', 'canceled', 'undone')), ...pageIn }, out: { items: t.arr(outboxRow), ...pageOut }, perm: 'connectors.manage', tool: 'records',
    }),
    write('connectors.outbox.retry', 'Retry a failed push now', { in: { outboxId }, out: { ok: t.bool() }, perm: 'connectors.manage', tool: 'records' }),
    write('connectors.outbox.cancel', 'Cancel a pending push (the local edit stays, marked not synced)', { in: { outboxId }, out: { ok: t.bool() }, perm: 'connectors.manage', tool: 'records' }),
    outward('connectors.push', 'Write one outbox item to the remote app (called by the outbox consumer only)', {
      in: { outboxId }, out: { state: t.enm('sent', 'failed'), error: t.opt(t.str()) }, level: 'use', idem: 'key', emits: ['sync.pushed', 'sync.push_failed'],
      gate: { act: 'none', reason: 'Consumer of an edit that already passed authorize; the person saw the dry-run preview and every push has an undo.' },
      errors: ['provider.rate_limited', 'provider.auth_failed'],
    }),
  ],
  health: [
    health('connectors.connections', 'Connections and sync', 'connectors.health', 'Reconnect the failing connection in Console > Integrations.', { pauses: ['sync'] }),
  ],
  screens: [
    screen('records.synced-header', 'records', 'ui:SyncedHeader', {
      q: { sync: ['sync_types.get', { type: '/state/type' }], changes: ['sync_types.schema_changes', { type: '/state/type' }] },
      a: {
        syncNow: ['connectors.sync_now', { type: '/state/type' }],
        pause: ['sync_types.pause', { type: '/state/type' }],
        resume: ['sync_types.resume', { type: '/state/type' }],
        native: ['sync_types.make_native', { type: '/state/type' }, 'Detach from the app and keep the records here?'],
        review: ['sync_types.review_schema', { type: '/state/type', accept: '/draft/accept', ignore: '/draft/ignore' }],
      },
      empty: 'This type is not synced',
    }),
    screen('records.sync-mapping', 'records', 'ui:SyncMapping', {
      slot: 'sheet',
      q: { sync: ['sync_types.get', { type: '/state/type' }], preview: ['sync_types.preview', { type: '/state/type' }, false] },
      a: { save: ['sync_types.update', { type: '/state/type', fields: '/draft/fields', conflict: '/draft/conflict', deletes: '/draft/deletes' }] },
      needs: ['connectors.manage'],
    }),
    screen('records.sync-log', 'records', 'ui:SyncLog', {
      slot: 'sheet', q: { log: ['sync_types.log', { type: '/state/type' }], outbox: ['connectors.outbox.list', { type: '/state/type' }] },
      a: { undo: ['sync_types.undo_push', { outboxId: '/state/outboxId' }, 'Undo this push?'], retry: ['connectors.outbox.retry', { outboxId: '/state/outboxId' }] }, needs: ['connectors.manage'],
    }),
    screen('records.sync-conflict', 'records', 'ui:SyncConflictCard', {
      slot: 'popover', q: { replay: ['sync_types.replay_conflict', { conflictId: '/state/conflictId' }, false] },
      a: { resolve: ['sync_types.resolve_conflict', { conflictId: '/state/conflictId', resolution: '/draft/resolution', value: '/draft/value' }] },
    }),
    screen('console.integrations', 'console', 'ui:ConsoleIntegrations', {
      q: { connectors: ['connectors.list'], connections: ['connections.list', { connector: '/state/connector' }], syncedTypes: ['sync_types.list', { connector: '/state/connector' }] },
      a: {
        connect: ['connections.create', { connector: '/state/connector', title: '/draft/title', ownerKind: '/draft/ownerKind', secrets: '/draft/secrets' }],
        pause: ['connections.pause', { connectionId: '/state/connectionId' }],
        resume: ['connections.resume', { connectionId: '/state/connectionId' }],
        reconnect: ['connections.reconnect', { connectionId: '/state/connectionId' }],
        remove: ['connections.delete', { connectionId: '/state/connectionId' }, 'Remove this connection?'],
        test: ['connections.test', { connectionId: '/state/connectionId' }],
      },
      needs: ['connectors.manage'], empty: 'No connectors yet', primary: 'Connect an app',
    }),
    screen('console.connector-build', 'console', 'ui:ConnectorBuild', {
      q: { connector: ['connectors.get', { key: '/state/connector' }], diff: ['connectors.diff', { key: '/state/connector', draftId: '/state/draftId' }], versions: ['connectors.versions', { key: '/state/connector' }] },
      a: {
        build: ['connectors.build', { key: '/state/connector', docsUrl: '/draft/docsUrl', notes: '/draft/notes' }],
        test: ['connectors.test', { key: '/state/connector', draftId: '/state/draftId' }],
        publish: ['connectors.publish', { key: '/state/connector', draftId: '/state/draftId', note: '/draft/note' }, 'Publish this version?'],
        rollback: ['connectors.rollback', { key: '/state/connector', version: '/state/version' }, 'Go back to this version?'],
        exportFolder: ['connectors.export', { key: '/state/connector' }],
      },
      needs: ['connectors.manage'],
    }),
  ],
});
