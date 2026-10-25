// sync (lane L1): server half of ARCHITECTURE-V1.md section 5. Hello, pull, push, snapshots, Yjs documents, epochs and purge.
// The client half (outbox, rebase, replica) lives in packages/sync and is not a module. Wire frames of 5.9 (ev, hb, turn, presence,
// ydoc.sync1/sync2/update/awareness, purge, op) are not capabilities; they call the capabilities below.
// DECISION: the HTTP routes of 5.2 to 5.8 are pinned with `http` so the wire paths stay exactly as written in the architecture.
// DECISION: doc subscribe and update check `authorize(view|edit)` against the document's owning row inside the handler, so the
//   capability is bound to the Space resource; the owning row is not a top-level input pointer.
import { defineManifest, ev, health, read, screen, setting, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut } from './_common.ts';

const hlc = t.str({ pattern: '^[0-9a-f]+-[0-9a-f]+-[a-z0-9_]+$', examples: ['18f3a1b2c3d-0001-dev_a1b2c3'], description: 'Hybrid logical clock: ms-hex, counter-hex, device id' });
const enc = t.obj({ key: t.str(), nonce: t.str() });
const fieldVal = t.obj({ v: t.json(), hlc, actor: t.str(), enc: t.opt(enc) });
const change = t.obj({
  seq: t.int({ minimum: 0 }), entity: t.str({ examples: ['rt_contact'] }), id: t.str({ examples: ['rec_a1b2c3'] }),
  op: t.enm('upsert', 'patch', 'delete'), fields: t.rec(fieldVal), trace: t.opt(id.trace),
});
const hideRow = t.obj({ entity: t.str(), id: t.str(), seq: t.int() });
const verr = t.obj({
  code: t.str({ examples: ['permission.no_grant'] }), message: t.str(), next: t.arr(t.obj({ kind: t.str(), label: t.str(), action: t.opt(t.json()) })),
  retryable: t.bool(), traceId: id.trace, details: t.opt(t.rec()),
});
const rejectedOp = t.obj({ opId: t.str(), error: verr, copyOut: t.json() });
const conflictNotice = t.obj({ conflictId: id.conflict, entity: t.str(), id: t.str(), field: t.str(), state: t.enm('open', 'proposed', 'needs_you', 'resolved') });
const deviceClass = t.enm('desktop', 'phone', 'web');
const op = t.obj({
  opId: t.str({ description: 'uuidv7, also the capability idempotency key', examples: ['0192f3a0-7b1c-7000-8000-000000000001'] }),
  traceId: id.trace, hlc, cap: t.str({ examples: ['records.update'] }), v: t.int({ minimum: 1 }),
  entity: t.opt(t.str()), id: t.opt(t.str()), input: t.json(), baseSeq: t.rec(t.int()), enc: t.opt(enc),
});

export default defineManifest({
  id: 'sync',
  title: 'Sync',
  owner: 'L1',
  capabilities: [
    read('sync.hello', 'Handshake: cursor, epoch, registry hash and replica schema versions; answers live, update_required, resync or purge', {
      in: { deviceId: id.device, deviceClass, appVersion: t.str({ examples: ['1.0.0'] }), registryHash: t.str(), cursor: t.int({ minimum: 0 }), epoch: t.int({ minimum: 0 }), replica: t.obj({ entities: t.rec(t.int()) }) },
      out: { serverVersion: t.str(), epoch: t.int(), serverHlc: hlc, mode: t.enm('live', 'update_required', 'resync', 'purge'), head: t.int(), entityVersions: t.rec(t.int()) },
      http: { method: 'POST', path: '/sync/v1/hello' }, errors: ['auth.device_revoked', 'auth.expired'],
    }),
    read('sync.pull', 'Pull changes after a cursor, already permission and label filtered for this person and device class, with hide rows for rows that left view', {
      in: { cursor: t.int({ minimum: 0 }), epoch: t.int({ minimum: 0 }), limit: t.opt(t.int({ minimum: 1, maximum: 5000 })), entities: t.opt(t.arr(t.str())) },
      out: {
        epoch: t.int(), changes: t.arr(change), hide: t.arr(hideRow), next: t.int(), more: t.bool(), serverHlc: hlc,
        conflicts: t.opt(t.arr(conflictNotice)), rejected: t.opt(t.arr(rejectedOp)), reset: t.opt(t.lit('purge')),
      },
      label: 'filter', http: { method: 'POST', path: '/sync/v1/pull' }, errors: ['auth.device_revoked'],
    }),
    write('sync.push', 'Push outbox ops in order; each op runs through invoke as the person; concurrent field edits merge by the field policy', {
      in: { deviceId: id.device, epoch: t.int({ minimum: 0 }), ops: t.arr(op, { maxItems: 200 }) },
      out: {
        applied: t.arr(t.obj({ opId: t.str(), seq: t.int() })), rejected: t.arr(rejectedOp), conflicts: t.arr(conflictNotice),
        held: t.arr(t.obj({ opId: t.str(), taskId: id.task })), serverHlc: hlc,
      },
      idem: 'natural', offline: 'online', emits: ['conflict.opened', 'sync.op_rejected'], risk: 'medium',
      http: { method: 'POST', path: '/sync/v1/push' }, errors: ['auth.device_revoked', 'validation.too_large', 'validation.version_conflict'],
    }),
    read('sync.snapshot.begin', 'Start an initial sync or resync: pins a read snapshot at asOfSeq and returns the plan of entities and row estimates', {
      in: { entities: t.opt(t.arr(t.str())), deviceClass },
      out: { asOfSeq: t.int(), plan: t.arr(t.obj({ entity: t.str(), estimatedRows: t.int() })), expiresAt: t.ts() },
      label: 'filter', http: { method: 'POST', path: '/sync/v1/snapshot/begin' },
    }),
    read('sync.snapshot.page', 'One page of a snapshot (up to 5000 rows, scoped to the person, rows carry field hlc and seq); sent as gzip NDJSON on the wire', {
      in: { entity: t.str(), after: t.opt(t.str()), asOf: t.int({ minimum: 0 }) },
      out: { rows: t.arr(t.rec()), last: t.opt(t.str()), done: t.bool() },
      label: 'filter', http: { method: 'GET', path: '/sync/v1/snapshot/page' }, errors: ['timeout.deadline'],
    }),
    read('sync.entities', 'Replica entities, schema versions and the window profile per device class (drives hello and the replica DDL)', {
      in: { deviceClass: t.opt(deviceClass) },
      out: { entities: t.arr(t.obj({ entity: t.str(), version: t.int(), profile: t.enm('all', 'window', 'none'), windowDays: t.opt(t.int()) })), registryHash: t.str() },
      tool: 'meta',
    }),
    read('sync.status', 'Sync state of this device: head, cursor, lag, epoch and the last full snapshot', {
      in: { deviceId: t.opt(id.device) },
      out: { head: t.int(), cursor: t.int(), lag: t.int(), epoch: t.int(), lastSnapshotAt: t.opt(t.ts()), openConflicts: t.int(), mode: t.enm('live', 'update_required', 'resync', 'purge') },
      tool: 'meta',
    }),
    read('sync.endpoints', 'Endpoints the server advertises for this Space (direct, relay, tunnel) for the client connection manager', {
      out: { endpoints: t.arr(t.obj({ kind: t.enm('direct', 'relay', 'tunnel'), url: t.str({ pattern: '^(https|wss)://', examples: ['wss://northwind.example.com/sync/v1/live'] }), rttMs: t.opt(t.int()) })), spaceKeyFingerprint: t.str() },
    }),
    read('sync.doc.open', 'Open a Yjs document: snapshot, pending updates and state vector (checked with authorize view)', {
      in: { doc: t.str({ examples: ['not_a1b2c3'] }), sv: t.opt(t.str({ description: 'Client state vector, base64' })) },
      out: { snapshot: t.opt(t.str({ description: 'Base64 Yjs snapshot' })), updates: t.arr(t.str()), sv: t.str(), upto: t.int(), md: t.opt(t.str()), enc: t.int({ minimum: 0, maximum: 2 }) },
      label: 'check', errors: ['validation.not_found'],
    }),
    write('sync.doc.update', 'Append an accepted Yjs update from a person or agent actor (checked with authorize edit on every update)', {
      in: { doc: t.str(), update: t.str({ description: 'Base64 Yjs update; ciphertext when enc is 2' }), enc: t.opt(t.int({ minimum: 0, maximum: 2 })), suggest: t.opt(t.bool()) },
      out: { seq: t.int() }, emits: ['doc.updated'], offline: 'online', label: 'check', risk: 'low', idem: 'none',
      rate: { n: 600, perSeconds: 60, scope: 'principal' }, errors: ['permission.revoked'],
    }),
    write('sync.doc.close', 'Close a document session: writes a named history version when the content changed since the last one', {
      in: { doc: t.str(), name: t.opt(t.str()) },
      out: { versioned: t.bool(), upto: t.int() }, emits: ['doc.compacted'], offline: 'online', risk: 'low',
    }),
    write('sync.doc.compact', 'Fold updates into a snapshot with the Markdown projection (every 500 updates or 10 minutes); E2E documents are compacted by the owner device', {
      in: { doc: t.str(), upto: t.opt(t.int()), snapshot: t.opt(t.str()), md: t.opt(t.str()) },
      out: { upto: t.int(), bytes: t.int() }, emits: ['doc.compacted'], idem: 'natural', risk: 'low',
    }),
    write('sync.epoch.bump', 'Raise a person sync epoch (device revoked, person suspended or removed, password reset, clearance lowered, key rotation) so old replicas purge', {
      in: { personId: id.user, reason: t.enm('device_revoked', 'suspended', 'removed', 'password_reset', 'clearance_lowered', 'key_rotation'), deviceId: t.opt(id.device) },
      out: { epoch: t.int() }, emits: ['sync.epoch_bumped'], audit: 'always', risk: 'high', idem: 'none',
      // P-SEC_06: a person's epoch purges that person's devices, so only an Admin (access.manage) or the host itself (svc_host, which skips authorize on its own internal calls) may raise it
      perm: 'access.manage', level: 'manage',
    }),
    write('sync.acl.reindex', 'Emit synthetic upsert or hide changes for rows whose visibility changed after a grant, revoke or label change', {
      in: { resourceType: t.str(), resourceId: t.str(), entity: t.opt(t.str()) },
      out: { changed: t.int(), scopeChanged: t.bool() }, emits: ['sync.scope_changed'], idem: 'natural', risk: 'medium',
    }),
    read('sync.health', 'Sync health: log head against the slowest live cursor, snapshot readers open, epoch counters', {
      out: { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()), head: t.int(), slowestCursorLag: t.int() },
    }),
    read('sync.devices.lag', 'Per device cursor lag for the Console (people, device class, last seen, lag in changes)', {
      in: { ...pageIn }, out: { devices: t.arr(t.obj({ deviceId: id.device, personId: id.user, deviceClass, cursor: t.int(), lag: t.int(), lastSeen: t.ts() })), ...pageOut },
      perm: null, level: 'manage', tool: 'engineer',
    }),
  ],
  events: [
    ev('conflict.opened', 'Two edits to a protected or concurrent field collided and the op was parked for the assistant', {
      p: { conflictId: id.conflict, entity: t.str(), recordId: t.str(), field: t.str(), actor: t.str(), plainChoice: t.bool(), traceId: id.trace },
      subject: ['entity', '/conflictId'], label: 'subject', redact: ['/recordId'],
    }),
    ev('sync.op_rejected', 'An op from a device was rejected (permission, label, lock or hold) and sits in that device Rejected list', {
      p: { opId: t.str(), personId: id.user, deviceId: id.device, cap: t.str(), code: t.str() },
      subject: ['entity', '/opId'], vis: 'owner', notify: 'sync.attention',
    }),
    ev('sync.epoch_bumped', 'A sync epoch was raised; older replicas receive purge', {
      p: { personId: id.user, epoch: t.int(), reason: t.str(), deviceId: t.opt(id.device) },
      subject: ['entity', '/personId'], vis: 'owner',
    }),
    ev('sync.scope_changed', 'A grant or label change affected many rows; clients refetch the entity range', {
      p: { entity: t.str(), personId: t.opt(id.user), filter: t.opt(t.json()), rows: t.int() },
      subject: ['entity', '/entity'], vis: 'participants',
    }),
    ev('doc.updated', 'A long text document received an accepted update (id and byte size only, never content)', {
      p: { doc: t.str(), bytes: t.int(), actor: t.str(), seq: t.int() },
      subject: ['entity', '/doc'], label: 'subject', trigger: { title: 'A document is edited' },
    }),
    ev('doc.compacted', 'A document was compacted into a snapshot and Markdown projection', {
      p: { doc: t.str(), upto: t.int(), bytes: t.int(), named: t.opt(t.str()) },
      subject: ['entity', '/doc'], label: 'subject',
    }),
  ],
  health: [
    health('sync', 'Sync', 'sync.health', 'Open Console > Infrastructure > Health, then restart the sync service', { pauses: ['sync'] }),
  ],
  settings: [
    setting('sync.phone_label_ceiling', 'space', 'Policies', 'Highest label mirrored to phones', t.enm('public', 'internal', 'confidential'), 'confidential', { floorable: true }),
    setting('sync.blob_cache_mb', 'person', 'This computer', 'File cache size on this computer (MB)', t.int({ minimum: 100, maximum: 100000 }), 2048),
  ],
  screens: [
    screen('shell.sync-status', 'shell', 'ui:SyncStatus', {
      slot: 'popover', q: { status: ['sync.status', {}, true] }, empty: 'All changes are saved', primary: 'Close',
    }),
  ],
});
