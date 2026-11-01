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

const fieldMap = t.obj({ key: fieldKey, remote: t.str(), dir, transform: t.opt(t.str({ description: 'Small expression over the value' })), relation: t.opt(id.recordType), inverse: t.opt(fieldKey), constant: t.opt(t.str({ description: 'A value stamped on every record this binding pulls (the From field)' })) });
const polling = t.obj({ activeSec: t.int({ minimum: 30 }), idleSec: t.int({ minimum: 60 }), dormantSec: t.int({ minimum: 300 }) });

/** The action names a connector uses to sync one object; a name left out keeps the convention list_<objects>, list_<objects>_after, create_<object>, update_<object>, delete_<object>. */
const objectActions = t.obj({
  list: t.opt(t.str()), listAfter: t.opt(t.str({ description: 'List the next page; takes { after }' })), create: t.opt(t.str()), update: t.opt(t.str()), delete: t.opt(t.str()), since: t.opt(t.bool()),
});

const connectorRow = t.obj({
  key: id.connector, title: t.str(), mode, scope: t.enm('person', 'space'), builtin: t.bool(), version: t.str({ examples: ['1.0.0'] }),
  state: t.enm('live', 'draft', 'failing_tests'), domains: t.arr(t.str()), secrets: t.arr(t.obj({ name: t.str(), description: t.str() })),
  connections: t.int({ minimum: 0 }), syncedTypes: t.arr(t.str()), actions: t.arr(t.str()), sources: t.arr(t.str()),
  objects: t.opt(t.rec(objectActions)),
  sourceFolderId: t.opt(id.folder),
});

const connectionRow = t.obj({
  connectionId: id.connection, connector: id.connector, title: t.str(),
  owner: t.obj({ kind: t.enm('person', 'space'), id: t.str() }),
  state: t.enm('pending', 'active', 'paused', 'needs_reconnect', 'failing'), pausedBy: t.opt(t.str()),
  scopes: t.arr(t.str()), lastSyncAt: t.opt(t.ts()), createdAt: t.ts(),
  handles: t.arr(id.handle, { description: 'The Vault handles this connection uses. Names only, never a value.' }),
  filled: t.arr(t.str(), { description: 'The secret slots that hold a Vault handle. A slot the connector declares and this list lacks is still empty.' }),
});

const syncedTypeRow = t.obj({
  syncTypeId, type: id.recordType, account: t.opt(t.str()), connector: id.connector, connectionId: id.connection, remote: t.str(),
  state: t.enm('initial', 'syncing', 'paused', 'needs_review', 'error'),
  fields: t.arr(fieldMap), match: t.arr(fieldKey), createAtSource: t.bool(), deletes, conflict: conflictRule, polling, nightlyReconcile: t.bool(),
  lastSyncAt: t.opt(t.ts()), pending: t.int({ minimum: 0 }), conflicts: t.int({ minimum: 0 }), schemaChanges: t.int({ minimum: 0 }),
  app: t.opt(t.obj({ title: t.str(), domain: t.opt(t.str()) })),
});

const bindingIn = {
  type: id.recordType, account: t.opt(t.str({ description: 'Which account of the app this binding reads; accounts of one app share the record type' })), connectionId: id.connection, remote: t.str({ examples: ['contacts'] }),
  fields: t.arr(fieldMap), match: t.arr(fieldKey), createAtSource: t.opt(t.bool()), deletes: t.opt(deletes), conflict: t.opt(conflictRule),
  polling: t.opt(polling), nightlyReconcile: t.opt(t.bool()),
};


// ---- SyncSpec: the one document an agent fills to bring an app's records into Records
const specPointer = t.str({ description: 'A JSON pointer: /id, /properties/email. / is the whole answer.', examples: ['/id'] });
const specField = t.obj({
  path: specPointer, label: t.str(), type: t.enm('text', 'number', 'money', 'date', 'bool', 'choice', 'multi', 'email', 'phone', 'url', 'relation', 'json'),
  choices: t.opt(t.arr(t.obj({ value: t.str(), label: t.opt(t.str()) }), { examples: [[{ value: 'lead', label: 'Lead' }]] })), relationTo: t.opt(t.str({ description: 'The remote object a relation points at' })), readOnly: t.opt(t.bool()),
});
const specCursor = t.obj({ kind: t.enm('none', 'page', 'cursor', 'offset', 'link'), param: t.opt(t.str()), next: t.opt(specPointer), size: t.opt(t.int({ minimum: 1 })), sizeParam: t.opt(t.str()), start: t.opt(t.int({ minimum: 0 })) });
const specWrite = t.obj({ path: t.str({ examples: ['/contacts/{id}'] }), method: t.opt(t.enm('POST', 'PUT', 'PATCH', 'DELETE')), evidence: t.str({ description: 'The docs page or quote that shows this call. A write without it is refused.' }), bodyAt: t.opt(t.str({ description: 'Pointer in the body where the properties go; empty for the body itself' })), idAt: t.opt(specPointer) });
const specObject = t.obj({
  remote: t.str(), label: t.str(), count: t.opt(t.int({ minimum: 0 })),
  list: t.obj({
    path: t.str({ examples: ['/contacts'] }), query: t.opt(t.rec(t.str())), cursor: t.opt(specCursor),
    updatedSince: t.opt(t.obj({ param: t.str(), format: t.opt(t.str()) })), filter: t.opt(t.obj({ param: t.str(), value: t.str() })),
  }),
  get: t.opt(t.obj({ path: t.str() })), create: t.opt(specWrite), update: t.opt(specWrite), delete: t.opt(specWrite),
  id: specPointer, updatedAt: t.opt(specPointer), itemsAt: specPointer, openUrl: t.opt(t.str({ description: 'Address of a record in the app; {id} is filled in. Shown as Open in the app.' })),
  fields: t.arr(specField),
  webhook: t.opt(t.obj({ events: t.arr(t.str()), subscribePath: t.opt(t.str()), evidence: t.opt(t.str()), manualUrl: t.opt(t.bool()), signature: t.opt(t.str()) })),
});
const specMapping = t.obj({
  remote: t.str(), recordType: id.recordType, title: t.opt(t.str()),
  fields: t.arr(t.obj({ path: specPointer, field: t.opt(fieldKey), direction: t.enm('both', 'pull', 'push', 'off') })),
  match: t.opt(t.arr(specPointer)), stagesFrom: t.opt(specPointer), titleField: t.opt(specPointer),
  deletes: t.opt(deletes), createAtSource: t.opt(t.bool()),
});
const syncSpec = t.obj({
  app: t.obj({ name: t.str(), domain: t.str({ examples: ['api.example.com'] }), docsUrl: t.opt(t.str()), logoHint: t.opt(t.str()), account: t.opt(t.str({ description: 'Which account of the app this is (a location, a workspace); accounts share record types and each record says which it came from' })) }),
  auth: t.obj({ vaultHandle: id.handle, style: t.enm('bearer', 'header', 'basic', 'query', 'oauth'), header: t.opt(t.str()), prefix: t.opt(t.str()), headers: t.opt(t.rec(t.str())) }),
  objects: t.arr(specObject, { minItems: 1 }),
  mapping: t.arr(specMapping, { minItems: 1 }),
  plan: t.obj({ firstPull: t.obj({ words: t.str({ description: 'Plain words: what the first pull brings in' }) }), backfill: t.enm('later', 'now'), conflicts: t.lit('newest'), audience: t.opt(t.enm('space', 'added', 'me')) }),
});
const discoverAuth = t.obj({ vaultHandle: id.handle, style: t.enm('bearer', 'header', 'basic'), header: t.opt(t.str()), prefix: t.opt(t.str()), headers: t.opt(t.rec(t.str())) });
const specProblem = t.obj({ level: t.enm('error', 'warn'), at: t.str(), message: t.str() });
const specChecks = {
  ok: t.bool(), problems: t.arr(specProblem),
  objects: t.arr(t.obj({ remote: t.str(), items: t.int(), hasNext: t.bool(), fieldsFound: t.int(), fieldsMissing: t.arr(t.str()), status: t.int() })),
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
    ev('connection.pending', 'A connection was started and waits for its sign-in; it exists (so its owner can use it) but is not announced as made yet', { p: { connectionId: id.connection, connector: id.connector, ownerKind: t.enm('person', 'space') }, subject: ['connection', '/connectionId'] }),
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
    read('connectors.list', 'List connectors: built-in, installed and drafts', { in: { state: t.opt(t.enm('live', 'draft', 'failing_tests')), ...pageIn }, out: { connectors: t.arr(connectorRow), ...pageOut }, perm: 'connectors.manage', tool: 'automations', cli: 'vyre connector list' }),
    read('connectors.get', 'Read one connector: auth, egress domains, secret names, sources, synced types and actions', { in: { key: id.connector }, out: { connector: connectorRow }, on: ['connector', '/key'], tool: 'automations' }),
    create('connectors.init', 'Scaffold a connector folder: connector.toml, transforms.js, tests, README', {
      in: { key: id.connector, title: t.str(), mode, docsUrl: t.opt(t.str()), source: t.opt(t.bool()) }, out: { key: id.connector, folderId: t.opt(id.folder) },
      // The key names the new connector, never an existing parent. Authorize its Space; connector.created registers the new resource there.
      perm: 'connectors.manage', emits: ['connector.created'], audit: 'always', tool: 'automations', cli: 'vyre connector init',
    }),
    write('connectors.define', 'Say what a draft connector is in one call: the hosts it may reach, how it signs in (a secret slot the connection fills from a Vault handle), and its actions. A GET is a read; anything else must be marked write. Replaces the draft; nothing goes live until publish.', {
      in: {
        key: id.connector, title: t.opt(t.str()), domains: t.arr(t.str(), { minItems: 1 }),
        auth: t.obj({ type: t.enm('none', 'api_key', 'bearer'), secret: t.opt(t.str()), header: t.opt(t.str()), prefix: t.opt(t.str()) }),
        secrets: t.opt(t.arr(t.obj({ name: t.str(), description: t.str() }))),
        actions: t.arr(t.obj({ name: t.str(), method: t.opt(t.enm('GET', 'POST', 'PUT', 'PATCH', 'DELETE')), url: t.str(), headers: t.opt(t.rec(t.str())), query: t.opt(t.rec(t.str())), output: t.opt(t.str()), write: t.opt(t.bool()) }), { minItems: 1 }),
      },
      out: { key: id.connector, draftId, actions: t.arr(t.str()), domains: t.arr(t.str()) },
      on: ['connector', '/key'], perm: 'connectors.manage', emits: ['connector.built'], audit: 'always', tool: 'automations',
    }),
    write('connectors.build', 'Run the build-connector flow: read the app docs, draft the connector, ask for a key through a Vault request, run the harness', {
      in: { key: id.connector, docsUrl: t.opt(t.str()), notes: t.opt(t.str()) }, out: { ...runStarted, draftId },
      on: ['connector', '/key'], perm: 'connectors.manage', idem: 'key', run: { kind: 'connector_build', stoppable: true }, emits: ['connector.built'], tool: 'engineer', cli: 'vyre connector build',
    }),
    read('connectors.test', 'Run the harness on recorded responses and report each case', {
      in: { key: id.connector, draftId: t.opt(draftId) }, out: { result: testResult }, on: ['connector', '/key'], perm: 'connectors.manage', tool: 'automations', cli: 'vyre connector test',
    }),
    outward('connectors.run', 'Run one connector action against the live app, sandboxed to the connector domains, with a dry run option', {
      in: { key: id.connector, action: t.str(), connectionId: id.connection, input: t.json(), dryRun: t.opt(t.bool()) }, out: { output: t.json(), dryRun: t.bool() },
      on: ['connector', '/key'], perm: 'connectors.manage', gate: { act: 'send', when: "actor.kind != 'person'" }, emits: ['connection.needs_reconnect'], tool: 'engineer', cli: 'vyre connector run',
    }),
    outward('connectors.read', 'Run one read action (a GET) of a connector against the live app, for the sync engine: reads are not held at the Gate for the person or agent the pass runs as, writes never go through here', {
      in: { key: id.connector, action: t.str(), connectionId: id.connection, input: t.json() }, out: { output: t.json() },
      on: ['connector', '/key'], perm: 'connectors.manage', gate: { act: 'none', reason: 'Reads a list for a sync pass and refuses every write; the sync engine is its only caller, so it carries no tool.' }, emits: ['connection.needs_reconnect'], errors: ['validation.precondition_failed', 'permission.no_grant', 'provider.auth_failed'],
    }),
    read('connectors.diff', 'Diff a draft against the live version of a connector', {
      in: { key: id.connector, draftId: t.opt(draftId) }, out: { files: t.arr(t.obj({ path: t.str(), added: t.int(), removed: t.int() })), breaking: t.bool() }, on: ['connector', '/key'], perm: 'connectors.manage', tool: 'engineer',
    }),
    write('connectors.publish', 'Publish a draft after a fresh test run; a failing test keeps the last good version live', {
      in: { key: id.connector, draftId: t.opt(draftId), note: t.opt(t.str()) }, out: { published: t.bool(), version: t.opt(t.str()), result: testResult },
      on: ['connector', '/key'], perm: 'connectors.manage', idem: 'key', audit: 'always', emits: ['connector.published', 'connector.publish_failed'], tool: 'automations', cli: 'vyre connector publish',
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
      in: { connector: t.opt(id.connector), whose: t.opt(t.enm('mine', 'space', 'all')), ...pageIn }, out: { connections: t.arr(connectionRow), ...pageOut }, tool: 'automations', label: 'filter',
    }),
    read('connections.get', 'Read one connection', { in: { connectionId: id.connection }, out: { connection: connectionRow }, on: ['connection', '/connectionId'], tool: 'automations' }),
    create('connections.create', 'Plug an account into a connector; secrets are named Vault items, never values', {
      in: { connector: id.connector, title: t.str(), ownerKind: t.enm('person', 'space'), secrets: t.opt(t.rec(id.handle)), scopes: t.opt(t.arr(t.str())) },
      out: { connection: connectionRow, authUrl: t.opt(t.str()) }, make: ['connection', '/connector'], perm: 'connectors.manage', emits: ['connection.created', 'connection.pending'], audit: 'always', tool: 'automations',
    }),
    write('connections.update', 'Rename a connection or change its scopes', { in: { connectionId: id.connection, title: t.opt(t.str()), scopes: t.opt(t.arr(t.str())) }, out: { connection: connectionRow }, on: ['connection', '/connectionId'], level: 'manage', tool: 'engineer' }),
    write('connections.set_secret', 'Fill one empty secret slot of a connection from a Vault handle (a name such as #Resend_Webhook.secret, never a value). The last empty slot turns a pending API connection active.', { in: { connectionId: id.connection, slot: t.str(), handle: id.handle }, out: { connection: connectionRow }, on: ['connection', '/connectionId'], level: 'manage', audit: 'always', tool: 'automations' }),
    write('connections.pause', 'The owner pauses a connection; syncing and actions stop', { in: { connectionId: id.connection }, out: { ok: t.bool() }, on: ['connection', '/connectionId'], level: 'manage', emits: ['connection.paused'], tool: 'engineer' }),
    write('connections.resume', 'The owner resumes a connection', { in: { connectionId: id.connection }, out: { ok: t.bool() }, on: ['connection', '/connectionId'], level: 'manage', emits: ['connection.resumed'], tool: 'engineer' }),
    write('connections.reconnect', 'Start signing in again; returns the provider sign-in address when one is needed', { in: { connectionId: id.connection }, out: { authUrl: t.opt(t.str()) }, on: ['connection', '/connectionId'], level: 'manage', tool: 'engineer' }),
    write('connections.complete_auth', 'Finish an OAuth sign-in from the callback: the state and the code, or the error the app sent back when the person declined. Only the person who started the sign-in can finish it', {
      in: { state: t.str(), code: t.opt(t.str()), error: t.opt(t.str()) }, out: { connectionId: id.connection }, level: 'use', emits: ['connection.reconnected', 'connection.created'], errors: ['auth.invalid_code', 'auth.unauthenticated', 'permission.no_grant', 'provider.auth_failed', 'provider.network', 'provider.bad_response', 'validation.precondition_failed'], offline: 'online',
    }),
    read('connections.test', 'Probe a connection with the connector health call', { in: { connectionId: id.connection }, out: { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()) }, on: ['connection', '/connectionId'], emits: ['connection.needs_reconnect'], tool: 'engineer' }),
    write('connections.delete', 'Remove a connection; synced types bound to it pause', { in: { connectionId: id.connection }, out: { deleted: t.bool() }, on: ['connection', '/connectionId'], level: 'manage', audit: 'always', emits: ['connection.deleted'], tool: 'engineer' }),
    // ---- synced types
    read('sync_types.list', 'List synced types with state, pending pushes, conflicts and schema changes', { in: { connector: t.opt(id.connector), ...pageIn }, out: { syncedTypes: t.arr(syncedTypeRow), ...pageOut }, tool: 'records', label: 'filter' }),
    read('sync_types.get', 'Read the sync binding of a record type (the header line, mapping and rules)', { in: { type: id.recordType, account: t.opt(t.str()) }, out: { syncedType: syncedTypeRow }, on: ['record_type', '/type'], tool: 'records', label: 'check' }),
    read('sync_types.discover', 'List remote objects and their fields with a proposed record type and mapping', {
      in: { connectionId: id.connection, remote: t.opt(t.str()) },
      out: { objects: t.arr(t.obj({ remote: t.str(), title: t.str(), fields: t.arr(t.obj({ remote: t.str(), type: t.str(), proposedKey: fieldKey, proposedType: t.str(), sensitive: t.bool() })) })) },
      on: ['connection', '/connectionId'], perm: 'connectors.manage', emits: ['connection.needs_reconnect'], tool: 'engineer',
    }),
    write('sync_types.create', 'Bind a record type (new or existing) to a remote object with field directions, match rule and conflict rule', {
      in: bindingIn, out: { syncedType: syncedTypeRow }, perm: 'connectors.manage', idem: 'key', audit: 'always', emits: ['sync.type_bound', 'schema.changed'], tool: 'engineer', errors: ['validation.duplicate'],
    }),
    write('sync_types.update', 'Change field directions, transforms, match, create-at-source, deletes, conflict rule or polling', {
      in: { type: id.recordType, account: t.opt(t.str()), fields: t.opt(t.arr(fieldMap)), match: t.opt(t.arr(fieldKey)), createAtSource: t.opt(t.bool()), deletes: t.opt(deletes), conflict: t.opt(conflictRule), polling: t.opt(polling), nightlyReconcile: t.opt(t.bool()) },
      out: { syncedType: syncedTypeRow }, on: ['record_type', '/type'], perm: 'connectors.manage', audit: 'always', emits: ['sync.type_updated'], tool: 'records',
    }),
    read('sync_types.preview', 'Dry run: what a sync would do, such as will update 34 records in HubSpot, and the first-sync match counts', {
      in: { type: id.recordType, account: t.opt(t.str()), direction: t.opt(t.enm('pull', 'push', 'both')) }, out: previewOut, on: ['record_type', '/type'], perm: 'connectors.manage', tool: 'records',
    }),
    write('sync_types.pause', 'Pause sync of a type', { in: { type: id.recordType, account: t.opt(t.str()) }, out: { ok: t.bool() }, on: ['record_type', '/type'], perm: 'connectors.manage', emits: ['sync.type_paused'], tool: 'records' }),
    write('sync_types.resume', 'Resume sync of a type', { in: { type: id.recordType, account: t.opt(t.str()) }, out: { ok: t.bool() }, on: ['record_type', '/type'], perm: 'connectors.manage', emits: ['sync.type_resumed'], tool: 'records' }),
    read('sync_types.log', 'Sync log: runs, pulls and pushes under one trace id each', {
      in: { type: id.recordType, account: t.opt(t.str()), ...pageIn },
      out: { entries: t.arr(t.obj({ at: t.ts(), kind: t.enm('pull', 'push', 'conflict', 'error', 'schema'), summary: t.str(), runId: t.opt(id.run), traceId: t.opt(id.trace) })), ...pageOut },
      on: ['record_type', '/type'], perm: 'connectors.manage', tool: 'records',
    }),
    read('sync_types.schema_changes', 'Remote schema changes waiting for review (for example 3 changes to review)', {
      in: { type: id.recordType, account: t.opt(t.str()) }, out: { changes: t.arr(t.obj({ changeKey: t.str(), kind: t.enm('field_added', 'field_removed', 'field_retyped', 'object_removed'), remote: t.str(), summary: t.str() })) },
      on: ['record_type', '/type'], perm: 'connectors.manage', tool: 'records',
    }),
    write('sync_types.review_schema', 'Accept or ignore remote schema changes; accepted ones go through schema.apply', {
      in: { type: id.recordType, account: t.opt(t.str()), accept: t.arr(t.str()), ignore: t.arr(t.str()) }, out: { accepted: t.int(), ignored: t.int() }, on: ['record_type', '/type'], perm: 'connectors.manage', emits: ['sync.type_updated', 'schema.changed'], tool: 'records',
    }),
    write('sync_types.confirm_deletes', 'Decide what happens when many records vanished at the source: mark them removed or keep them', {
      in: { type: id.recordType, account: t.opt(t.str()), decision: t.enm('mark_removed', 'keep') }, out: { removed: t.int() }, on: ['record_type', '/type'], perm: 'connectors.manage', audit: 'always', emits: ['sync.type_updated'], tool: 'records',
    }),
    write('sync_types.make_native', 'Detach a synced type and keep it as a native type with its ids, history and attribution', {
      in: { type: id.recordType, account: t.opt(t.str()) }, out: { ok: t.bool() }, on: ['record_type', '/type'], perm: 'connectors.manage', audit: 'always', emits: ['sync.type_native'], tool: 'records', agent: { planMode: 'blocked' },
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
    // ---- SyncSpec: bring an app's records into Records
    read('sync_specs.validate', 'Check a SyncSpec against a real sampled page of the app (read-only GET with the Vault handle): the list, ids, next page, every mapped field path, value types and choices. Writes nothing', {
      in: { spec: syncSpec }, out: specChecks, perm: 'connectors.manage', tool: 'records', cli: 'vyre sync-spec validate', errors: ['validation.bad_input', 'internal.unavailable'],
    }),
    read('sync_specs.preview', 'Dry run of a SyncSpec: the record types it would make, three sample records drawn from the real page, and what the first pull would bring in. Writes nothing to Vyre or to the app', {
      in: { spec: syncSpec },
      out: {
        ...specChecks, summary: t.str(), size: t.obj({ records: t.int({ minimum: 0 }), bytes: t.int({ minimum: 0 }), text: t.str({ examples: ['about 180 MB'] }) }),
        types: t.arr(t.obj({ type: id.recordType, remote: t.str(), isNew: t.bool(), title: t.str(), existing: t.int(), fields: t.arr(t.obj({ key: fieldKey, label: t.str(), type: t.str(), dir: t.str() })) })),
        samples: t.arr(t.obj({ type: id.recordType, remote: t.str(), title: t.str(), fields: t.arr(t.obj({ key: fieldKey, label: t.str(), value: t.json() })) })),
      },
      perm: 'connectors.manage', tool: 'records', errors: ['validation.bad_input', 'internal.unavailable'],
    }),
    read('sync_specs.sample', 'Read one page of an app, read-only (GET only), with a Vault handle as the key: where the lists are, what one item holds, how the next page is asked for, a total if there is one. Also reads field-metadata and schema endpoints', {
      in: { auth: discoverAuth, domain: t.str({ examples: ['api.example.com'] }), path: t.str({ examples: ['/contacts'] }), query: t.opt(t.rec(t.str())), url: t.opt(t.str({ description: 'A full address on the same host, such as a next link' })), items: t.opt(t.int({ minimum: 1, maximum: 10 })) },
      out: {
        status: t.int(), ok: t.bool(), reason: t.opt(t.str()), nextLink: t.opt(t.str()), items: t.opt(t.arr(t.json())), preview: t.opt(t.str()),
        shape: t.opt(t.obj({
          kind: t.enm('object', 'array', 'empty', 'text'),
          lists: t.arr(t.obj({ itemsAt: t.str(), count: t.int(), idAt: t.opt(t.str()), updatedAtGuess: t.opt(t.str()), fields: t.arr(t.obj({ path: t.str(), type: t.str(), seen: t.int(), example: t.opt(t.str()) })) })),
          cursors: t.arr(t.obj({ pointer: t.str(), value: t.str() })), totals: t.arr(t.obj({ pointer: t.str(), value: t.int() })), keys: t.opt(t.arr(t.str())),
        })),
        estimate: t.opt(t.obj({ count: t.int(), source: t.str() })),
      },
      perm: 'connectors.manage', tool: 'records', cli: 'vyre sync-spec sample', errors: ['validation.bad_input', 'permission.no_grant', 'internal.unavailable'],
    }),
    read('sync_specs.survey', 'Read up to 12 paths of an app at once, read-only, and say for each what lists it holds, how many items, a total if given. Use it to see which objects an app has', {
      in: { auth: discoverAuth, domain: t.str(), paths: t.arr(t.str(), { minItems: 1, maxItems: 12 }) },
      out: { results: t.arr(t.obj({ path: t.str(), status: t.int(), reason: t.opt(t.str()), lists: t.arr(t.obj({ itemsAt: t.str(), count: t.int(), idAt: t.opt(t.str()), fields: t.int() })), total: t.opt(t.int()), nextLink: t.opt(t.bool()) })) },
      perm: 'connectors.manage', tool: 'records', errors: ['validation.bad_input', 'permission.no_grant', 'internal.unavailable'],
    }),
    write('sync_specs.apply', 'Apply a validated SyncSpec: a live connector (with its own tests), a connection holding the Vault handle, the record types with fields, choices, relations and stages, the synced-type bindings, and the first pull', {
      in: { spec: syncSpec },
      out: { connector: id.connector, connectionId: id.connection, version: t.str(), types: t.arr(t.obj({ type: id.recordType, syncTypeId, runId: t.opt(id.run) })), live: t.enm('polling', 'webhook'), webhookUrl: t.opt(t.str({ description: 'The address to give the app by hand when its docs show no subscribe call' })) },
      perm: 'connectors.manage', idem: 'key', audit: 'always', emits: ['connector.created', 'connector.published', 'connection.created', 'sync.type_bound', 'schema.changed'], tool: 'records', cli: 'vyre sync-spec apply',
      agent: { planMode: 'blocked' }, errors: ['validation.bad_input', 'validation.precondition_failed', 'validation.duplicate', 'internal.unavailable'],
    }),
    read('sync_specs.get', 'Read the SyncSpec a synced type was made from (so Edit mapping can open the agent with it)', {
      in: { type: t.opt(id.recordType), account: t.opt(t.str()), connector: t.opt(id.connector) },
      out: { spec: syncSpec, connector: id.connector, connectionId: id.connection, appliedAt: t.ts(), types: t.arr(t.obj({ type: id.recordType, remote: t.str() })) },
      perm: 'connectors.manage', tool: 'records', errors: ['validation.not_found'],
    }),
    write('sync_specs.backfill', 'Bring in everything, not just the first-pull filter: re-applies the stored spec with the filter dropped and starts the pull', {
      in: { type: id.recordType, account: t.opt(t.str()) }, out: { runId: t.opt(id.run) },
      perm: 'connectors.manage', idem: 'key', audit: 'always', emits: ['connector.published'], tool: 'records', errors: ['validation.not_found', 'validation.precondition_failed'],
    }),
    read('sync_types.record_state', 'Where one record came from and how each of its synced fields is doing: saved, saving, failed or only here, with the address to open it in the app', {
      in: { type: id.recordType, recordId: id.record },
      out: {
        synced: t.bool(), state: t.enm('synced', 'saving', 'failed', 'local'), lastSyncAt: t.opt(t.ts()), remoteId: t.opt(t.str()), openUrl: t.opt(t.str()),
        app: t.opt(t.obj({ key: id.connector, title: t.str(), domain: t.opt(t.str()) })),
        fields: t.arr(t.obj({ key: fieldKey, dir, state: t.enm('synced', 'saving', 'failed', 'local'), at: t.opt(t.ts()), error: t.opt(t.str()), outboxId: t.opt(outboxId), history: t.int({ minimum: 0 }) })),
      },
      on: ['record', '/recordId'], tool: 'records', label: 'check',
    }),
    read('sync_types.field_history', 'The earlier values of one field that a newest-wins settlement replaced: yours when the app was newer, the app\'s when you were', {
      in: { type: id.recordType, recordId: id.record, field: fieldKey },
      out: { entries: t.arr(t.obj({ historyId: t.str(), value: t.json(), at: t.opt(t.ts()), replacedBy: t.enm('app', 'you', 'push'), by: t.opt(t.str()), actor: t.str() })) },
      on: ['record', '/recordId'], tool: 'records', label: 'check',
    }),
    write('sync_types.restore_field', 'Put an earlier value of a field back (an ordinary edit, newer than the app\'s value, so it is sent on the next pass) and start that pass', {
      in: { type: id.recordType, recordId: id.record, field: fieldKey, historyId: t.str() }, out: { ok: t.bool(), runId: t.opt(id.run) },
      on: ['record', '/recordId'], perm: 'records.edit', tool: 'records', emits: ['record.updated'], errors: ['validation.not_found', 'validation.bad_input', 'validation.field_locked'],
    }),
    read('sync_types.status', 'The Sync page of a synced type: last pass, counts, failures, pushes waiting, whether a first-pull filter still holds, and the next poll', {
      in: { type: id.recordType, account: t.opt(t.str()) },
      out: {
        type: id.recordType, app: t.obj({ key: id.connector, title: t.str(), domain: t.opt(t.str()) }), state: t.enm('initial', 'syncing', 'paused', 'needs_review', 'error'), paused: t.bool(), deletes, conflict: conflictRule,
        account: t.opt(t.str()), accounts: t.opt(t.arr(t.obj({ account: t.str(), state: t.str(), records: t.int({ minimum: 0 }), estimate: t.opt(t.int({ minimum: 0 })), pending: t.int({ minimum: 0 }) }))), polling, records: t.int({ minimum: 0 }), estimate: t.opt(t.int({ minimum: 0 })), filter: t.opt(t.str()), canBackfill: t.bool(), catchingUp: t.opt(t.bool()), lastRun: t.opt(t.obj({ at: t.ts(), summary: t.str() })),
        pending: t.int({ minimum: 0 }), failedPushes: t.int({ minimum: 0 }), conflicts: t.int({ minimum: 0 }), schemaChanges: t.int({ minimum: 0 }),
        failures: t.arr(t.obj({ at: t.ts(), summary: t.str() })), sentToday: t.int({ minimum: 0 }), nextPollAt: t.opt(t.ts()), spec: t.bool(),
      },
      on: ['record_type', '/type'], tool: 'records', label: 'check', errors: ['validation.not_found'],
    }),
    write('sync_specs.remove', 'Stop syncing an app into Records and remove its connector and connection; keep its records as plain records, or remove them with their types (a copy waits in Trash for 30 days)', {
      in: { type: id.recordType, account: t.opt(t.str()), records: t.enm('keep', 'remove') }, out: { detached: t.arr(id.recordType), removed: t.arr(id.recordType) },
      on: ['record_type', '/type'], perm: 'connectors.manage', audit: 'always', emits: ['sync.type_native', 'connection.deleted', 'connector.removed', 'schema.changed', 'schema.type_dropped'], tool: 'records',
      agent: { planMode: 'blocked' }, errors: ['validation.not_found', 'validation.precondition_failed'],
    }),
    // ---- sync engine
    write('connectors.sync_now', 'Start a sync Run for a synced type or a connection; modes: incremental, reconcile, backfill, dry_run', {
      in: { syncTypeId: t.opt(syncTypeId), type: t.opt(id.recordType), account: t.opt(t.str()), connectionId: t.opt(id.connection), mode: t.opt(t.enm('incremental', 'reconcile', 'backfill', 'dry_run')), runAutomations: t.opt(t.bool()) },
      out: runStarted, run: { kind: 'connector_sync', stoppable: true }, perm: null, idem: 'key', emits: ['sync.completed', 'sync.conflict', 'sync.deletes_paused', 'sync.schema_changed', 'record.updated'], tool: 'records', offline: 'online',
    }),
    write('connectors.sync_run', 'Run the pass a sync_now asked for, in the background as the person who asked, and finish its Run (called by the scheduler)', {
      in: { runId: id.run }, out: { ok: t.bool(), summary: t.str() }, perm: null, emits: ['sync.completed', 'sync.conflict', 'sync.deletes_paused', 'sync.pushed', 'sync.push_failed', 'record.created', 'record.updated'],
    }),
    write('connectors.sync_poll', 'Keep a synced type current when the app has no webhook: pull what changed, push what people changed here, and schedule the next poll (called by the scheduler)', {
      in: { type: id.recordType }, out: { ran: t.bool(), summary: t.opt(t.str()) }, perm: null, emits: ['sync.completed', 'sync.conflict', 'sync.deletes_paused', 'sync.pushed', 'sync.push_failed', 'record.created', 'record.updated'],
    }),
    read('connectors.outbox.list', 'Pending, failed and recent pushes with their idempotency keys', {
      in: { type: t.opt(id.recordType), account: t.opt(t.str()), state: t.opt(t.enm('pending', 'sent', 'failed', 'canceled', 'undone')), ...pageIn }, out: { items: t.arr(outboxRow), ...pageOut }, perm: 'connectors.manage', tool: 'records',
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
