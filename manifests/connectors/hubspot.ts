// hubspot (lane L3): built-in example connector with two-way synced types (spec 2.10; connectors/hubspot/connector.toml compiles to this).
import { conn, defineManifest, ev, health, read, t, write } from '../../packages/contracts/src/index.ts';
import { id } from '../_common.ts';

const probe = { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()) };

export default defineManifest({
  id: 'hubspot',
  title: 'HubSpot',
  kind: 'connector',
  owner: 'L3',
  events: [
    ev('hubspot.webhook_received', 'A HubSpot webhook arrived and was verified', { p: { objectType: t.str(), objectId: t.str(), providerEventId: t.str() }, subject: ['entity', '/objectId'] }),
  ],
  capabilities: [
    read('hubspot.test_connection', 'Check the HubSpot token and portal', { in: { connectionId: id.connection }, out: { ok: t.bool(), portalId: t.opt(t.str()) }, on: ['connection', '/connectionId'], tool: 'engineer' }),
    read('hubspot.list_objects', 'List remote objects of a type (contacts, companies, deals) for mapping', { in: { connectionId: id.connection, objectType: t.enm('contacts', 'companies', 'deals'), cursor: t.opt(t.str()) }, out: { objects: t.arr(t.rec()), next: t.opt(t.str()) }, on: ['connection', '/connectionId'], tool: 'engineer' }),
    write('hubspot.push_object', 'Push one record change to HubSpot (stores the replaced value so the push can be undone)', { in: { connectionId: id.connection, objectType: t.str(), remoteId: t.opt(t.str()), properties: t.rec() }, out: { remoteId: t.str(), replaced: t.opt(t.rec()) }, on: ['connection', '/connectionId'], perm: 'connectors.manage', tool: 'engineer' }),
    read('hubspot.health', 'Probe: GET account details', { out: probe }),
  ],
  health: [health('hubspot.api', 'HubSpot reachable', 'hubspot.health', 'Reconnect HubSpot in Console, Integrations.', { pauses: ['sync'] })],
  connectors: [conn('hubspot', 'HubSpot', {
    mode: 'api', scope: 'space', auth: { type: 'oauth2', authUrl: 'https://app.hubspot.com/oauth/authorize', tokenUrl: 'https://api.hubapi.com/oauth/v1/token', scopes: ['crm.objects.contacts.read', 'crm.objects.contacts.write', 'crm.objects.companies.read', 'crm.objects.companies.write'], pkce: true },
    domains: ['api.hubapi.com', 'app.hubspot.com'], secrets: [{ name: 'HubSpot_Token', description: 'Private app token or OAuth refresh token' }],
    sources: [{ key: 'webhook', path: '/hooks/hubspot', verify: 'signature', event: 'hubspot.webhook_received', dedupe: '/providerEventId' }],
    syncedTypes: [
      { type: 'contact', remote: 'contacts', fields: [{ key: 'name', remote: 'firstname', dir: 'both' }, { key: 'email', remote: 'email', dir: 'both' }, { key: 'phone', remote: 'phone', dir: 'both' }], match: ['email'], createAtSource: false, deletes: 'off', conflict: 'ask', polling: { activeSec: 120, idleSec: 900, dormantSec: 3600 }, nightlyReconcile: true },
      { type: 'company', remote: 'companies', fields: [{ key: 'name', remote: 'name', dir: 'both' }, { key: 'website', remote: 'domain', dir: 'pull' }], match: ['website'], createAtSource: false, deletes: 'off', conflict: 'newest', polling: { activeSec: 120, idleSec: 900, dormantSec: 3600 }, nightlyReconcile: true },
    ],
    actions: ['hubspot.test_connection', 'hubspot.list_objects', 'hubspot.push_object'], health: 'hubspot.api', rate: { rps: 8, burst: 16 },
  })],
});
