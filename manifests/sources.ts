// sources (lane L3): the one inbound pipeline from outside events to records (spec 2.10, architecture section 8 'Common pipeline').
// /hooks/<source> on the public listener: verify, dedupe on provider id, normalise, upsert through records.bulk_upsert, one shared linking step.
// Imports and backfills fire no automations unless the importer ticks run automations.
import { create, defineManifest, ev, health, read, screen, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut } from './_common.ts';

const sourceId = t.id('src');
const deliveryId = t.id('dlv');
const matchId = t.id('mat');
const fieldKey = t.str({ pattern: '^[a-z][a-z0-9_]*$', examples: ['email'] });

const mapping = t.obj({
  dedupe: t.str({ description: 'JSON pointer to the provider id in the payload', examples: ['/id'] }),
  fields: t.arr(t.obj({ from: t.str({ description: 'JSON pointer into the payload', examples: ['/customer/email'] }), to: fieldKey, transform: t.opt(t.str({ description: 'Small expression over the value' })) })),
  match: t.arr(fieldKey, { description: 'Fields that identify an existing record for upsert' }),
  link: t.opt(t.arr(fieldKey, { description: 'Fields the linking step uses to find a sure match' })),
});

const sourceRow = t.obj({
  sourceId, key: t.str({ examples: ['stripe'] }), title: t.str(), connector: t.opt(id.connector), connectionId: t.opt(id.connection),
  path: t.str({ examples: ['/hooks/stripe'] }), verify: t.enm('hmac', 'signature', 'none'), type: id.recordType,
  state: t.enm('active', 'paused', 'failing'), lastReceivedAt: t.opt(t.ts()), received24h: t.int({ minimum: 0 }), failed24h: t.int({ minimum: 0 }),
  mapping: t.opt(mapping),
});

const deliveryRow = t.obj({
  deliveryId, sourceId, receivedAt: t.ts(), providerId: t.opt(t.str()),
  status: t.enm('accepted', 'duplicate', 'rejected', 'failed', 'linked_pending'), error: t.opt(t.str()), recordIds: t.arr(id.record),
});

const candidate = t.obj({ recordId: id.record, type: id.recordType, score: t.num({ minimum: 0, maximum: 1 }), reasons: t.arr(t.str()) });

export default defineManifest({
  id: 'sources',
  title: 'Sources',
  owner: 'L3',
  events: [
    ev('source.received', 'An outside event arrived on /hooks/<source>, was verified and accepted', {
      p: { sourceId, deliveryId, source: t.str(), providerId: t.opt(t.str()), type: t.opt(id.recordType), recordIds: t.arr(id.record) },
      subject: ['entity', '/deliveryId'], trigger: { title: 'A source delivers an event', fields: ['/source', '/type'] },
    }),
    ev('source.deduped', 'A delivery repeated a provider id already seen and was dropped', { p: { sourceId, deliveryId, providerId: t.str() }, subject: ['entity', '/deliveryId'] }),
    ev('source.rejected', 'A delivery failed verification (signature or secret) and was refused', { p: { sourceId: t.opt(sourceId), source: t.str(), reason: t.enm('bad_signature', 'unknown_source', 'paused', 'too_large', 'bad_payload') }, subject: ['entity', '/source'] }),
    ev('source.mapping_failed', 'A verified delivery could not be mapped to a record', { p: { sourceId, deliveryId, error: t.str() }, subject: ['entity', '/deliveryId'], notify: 'sync.attention' }),
    ev('source.linked', 'The linking step attached a delivery to an existing record (sure match or person-confirmed)', { p: { sourceId, deliveryId, recordId: id.record, by: t.enm('rule', 'person') }, subject: ['record', '/recordId'], label: 'subject' }),
    ev('source.link_pending', 'The linking step found only unsure matches and sent them to Needs you', { p: { sourceId, deliveryId, matchId, candidates: t.int() }, subject: ['entity', '/matchId'], notify: 'sync.attention' }),
    ev('source.created', 'A source was set up', { p: { sourceId, key: t.str(), type: id.recordType }, subject: ['entity', '/sourceId'] }),
    ev('source.updated', 'A source mapping or setting changed', { p: { sourceId, fields: t.arr(t.str()) }, subject: ['entity', '/sourceId'] }),
    ev('source.paused', 'A source was paused; deliveries are refused with a visible reason', { p: { sourceId }, subject: ['entity', '/sourceId'] }),
    ev('source.resumed', 'A paused source was resumed', { p: { sourceId }, subject: ['entity', '/sourceId'] }),
    ev('source.deleted', 'A source was removed', { p: { sourceId }, subject: ['entity', '/sourceId'] }),
  ],
  capabilities: [
    read('sources.list', 'List sources, optionally those feeding one record type (the Sources page on a record type)', {
      in: { type: t.opt(id.recordType), state: t.opt(t.enm('active', 'paused', 'failing')), ...pageIn }, out: { sources: t.arr(sourceRow), ...pageOut }, perm: 'connectors.manage', tool: 'records',
    }),
    read('sources.get', 'Read one source with its mapping', { in: { sourceId }, out: { source: sourceRow }, perm: 'connectors.manage', tool: 'records' }),
    read('sources.kinds', 'Source kinds a person can set up: connectors that declare sources plus the generic webhook', {
      out: { kinds: t.arr(t.obj({ key: t.str(), title: t.str(), connector: t.opt(id.connector), verify: t.enm('hmac', 'signature', 'none'), needsTeamSpace: t.bool() })) }, tool: 'records',
    }),
    create('sources.create', 'Set up a source: a connector source or a generic webhook with a mapping into a record type', {
      in: { connector: id.connector, title: t.str(), type: id.recordType, mapping, verify: t.opt(t.enm('hmac', 'signature', 'none')), secretName: t.opt(t.str({ description: 'Vault item name holding the signing secret; never the value' })), connectionId: t.opt(id.connection) },
      out: { source: sourceRow }, perm: 'connectors.manage', emits: ['source.created'], audit: 'always', team: true, tool: 'records',
    }),
    write('sources.update', 'Change the mapping, target type or verification of a source', {
      in: { sourceId, title: t.opt(t.str()), type: t.opt(id.recordType), mapping: t.opt(mapping), verify: t.opt(t.enm('hmac', 'signature', 'none')) },
      out: { source: sourceRow }, perm: 'connectors.manage', emits: ['source.updated'], audit: 'always', tool: 'records',
    }),
    write('sources.set_secret', 'Point a source at the Vault item holding its signing secret (name only, never the value)', {
      in: { sourceId, secretName: t.str() }, out: { ok: t.bool() }, perm: 'connectors.manage', emits: ['source.updated'], audit: 'always', tool: 'records',
    }),
    write('sources.pause', 'Pause a source; deliveries are refused with a visible reason', { in: { sourceId, reason: t.opt(t.str()) }, out: { ok: t.bool() }, perm: 'connectors.manage', emits: ['source.paused'], tool: 'records' }),
    write('sources.resume', 'Resume a paused source', { in: { sourceId }, out: { ok: t.bool() }, perm: 'connectors.manage', emits: ['source.resumed'], tool: 'records' }),
    write('sources.delete', 'Remove a source (records already created stay)', { in: { sourceId }, out: { deleted: t.bool() }, perm: 'connectors.manage', emits: ['source.deleted'], audit: 'always', tool: 'records' }),
    read('sources.preview_mapping', 'Dry-run a mapping on a sample payload: the normalised row, create or update, and the linking outcome', {
      in: { sourceId: t.opt(sourceId), mapping: t.opt(mapping), type: t.opt(id.recordType), payload: t.json() },
      out: { normalized: t.rec(), action: t.enm('create', 'update', 'skip'), link: t.obj({ sure: t.opt(id.record), unsure: t.arr(candidate) }), problems: t.arr(t.str()) },
      perm: 'connectors.manage', tool: 'records',
    }),
    read('sources.deliveries.list', 'Delivery log of a source: status, provider id, error, records touched (payloads are not stored in the log)', {
      in: { sourceId, status: t.opt(t.enm('accepted', 'duplicate', 'rejected', 'failed', 'linked_pending')), ...pageIn }, out: { deliveries: t.arr(deliveryRow), ...pageOut }, perm: 'connectors.manage', tool: 'records',
    }),
    write('sources.replay', 'Process a failed delivery again after fixing the mapping', {
      in: { deliveryId }, out: { status: t.enm('accepted', 'duplicate', 'rejected', 'failed'), recordIds: t.arr(id.record) }, perm: 'connectors.manage', idem: 'key', emits: ['source.received', 'source.mapping_failed'], tool: 'records',
    }),
    write('sources.ingest', 'Pipeline entry called by the public listener for /hooks/<source>: verify, dedupe on provider id, normalise, upsert, link', {
      in: { source: t.str({ examples: ['stripe'] }), receivedAt: t.ts(), headers: t.rec(t.str()), body: t.str({ description: 'Raw request body, needed for signature checks' }), runAutomations: t.opt(t.bool()) },
      out: { status: t.enm('accepted', 'duplicate', 'rejected', 'failed'), deliveryId: t.opt(deliveryId), recordIds: t.arr(id.record) },
      level: 'use', idem: 'natural', emits: ['source.received', 'source.deduped', 'source.rejected', 'source.mapping_failed', 'source.linked', 'source.link_pending'],
      team: true, errors: ['auth.unauthenticated', 'validation.too_large', 'rate_limit.exceeded'], offline: 'online',
    }),
    read('sources.link.match', 'The shared linking step: find a sure match or unsure candidates for a normalised row', {
      in: { type: id.recordType, row: t.rec(), by: t.opt(t.arr(fieldKey)) },
      out: { sure: t.opt(id.record), unsure: t.arr(candidate) }, label: 'filter',
    }),
    read('sources.link.list_pending', 'Unsure matches waiting for a person (they also arrive in Needs you)', {
      in: { type: t.opt(id.recordType), ...pageIn },
      out: { pending: t.arr(t.obj({ matchId, deliveryId, sourceId, type: id.recordType, row: t.rec(), candidates: t.arr(candidate) })), ...pageOut }, tool: 'records', label: 'filter',
    }),
    write('sources.link.resolve', 'Settle an unsure match: link to a candidate, create a new record, or ignore', {
      in: { matchId, recordId: t.opt(id.record), createNew: t.opt(t.bool()), ignore: t.opt(t.bool()) },
      out: { recordId: t.opt(id.record) }, perm: 'records.edit', emits: ['source.linked'], tool: 'records', errors: ['validation.precondition_failed'],
    }),
    read('sources.health', 'Intake health: public address reachable, oldest unprocessed delivery, failing sources', {
      out: { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()) },
    }),
  ],
  health: [
    health('sources.intake', 'Webhook intake', 'sources.health', 'Check that the public address is reachable and that each source has its secret in the Vault.'),
  ],
  screens: [
    screen('records.sources', 'records', 'ui:SourcesPage', {
      q: { sources: ['sources.list', { type: '/state/type' }], pending: ['sources.link.list_pending', { type: '/state/type' }] },
      a: {
        pause: ['sources.pause', { sourceId: '/state/sourceId' }],
        resume: ['sources.resume', { sourceId: '/state/sourceId' }],
        resolve: ['sources.link.resolve', { matchId: '/state/matchId', recordId: '/draft/recordId', createNew: '/draft/createNew', ignore: '/draft/ignore' }],
      },
      needs: ['connectors.manage'], empty: 'No sources feed this type yet', primary: 'Add a source',
    }),
    screen('console.sources', 'console', 'ui:ConsoleSources', {
      q: { sources: ['sources.list', {}], kinds: ['sources.kinds'] },
      a: {
        create: ['sources.create', { connector: '/draft/connector', title: '/draft/title', type: '/draft/type', mapping: '/draft/mapping' }],
        test: ['sources.preview_mapping', { sourceId: '/state/sourceId', payload: '/draft/payload' }],
        replay: ['sources.replay', { deliveryId: '/state/deliveryId' }],
        remove: ['sources.delete', { sourceId: '/state/sourceId' }, 'Remove this source?'],
      },
      needs: ['connectors.manage'], empty: 'No sources yet', primary: 'Add a source',
    }),
  ],
});
