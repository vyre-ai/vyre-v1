// documenso (lane L8): e-signature provider behind the EsignProvider interface (spec 3.6 b19, ARCH 8.4).
import { conn, defineManifest, ev, health, read, t, write } from '../../packages/contracts/src/index.ts';
import { id } from '../_common.ts';

const envelope = t.str({ examples: ['env_a1b2c3'] });

export default defineManifest({
  id: 'documenso',
  title: 'Documenso',
  kind: 'connector',
  owner: 'L8',
  events: [
    ev('documenso.webhook_received', 'A Documenso webhook arrived and was verified', { p: { providerEventId: t.str(), envelopeId: envelope, status: t.str() }, subject: ['entity', '/envelopeId'] }),
  ],
  capabilities: [
    write('documenso.create', 'Create an envelope at Documenso', { in: { fileId: id.file, signers: t.arr(t.obj({ name: t.str(), email: t.str() })) }, out: { remoteId: t.str() }, perm: 'connectors.manage', team: true }),
    read('documenso.status', 'Envelope status at Documenso', { in: { remoteId: t.str() }, out: { status: t.str() } }),
    write('documenso.cancel', 'Cancel an envelope at Documenso', { in: { remoteId: t.str() }, out: { cancelled: t.bool() }, perm: 'connectors.manage', team: true }),
    read('documenso.fetch_signed', 'Download the signed PDF and audit certificate from Documenso', { in: { remoteId: t.str() }, out: { fileId: id.file } }),
    read('documenso.health', 'Probe: the Documenso account endpoint answers', { out: { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()) } }),
  ],
  health: [health('documenso.api', 'Documenso reachable', 'documenso.health', 'Reconnect Documenso in Console, Integrations.')],
  connectors: [conn('documenso', 'Documenso', {
    mode: 'api', scope: 'space', auth: { type: 'api_key', secret: 'Documenso_Token' },
    domains: ['documenso.internal'], secrets: [{ name: 'Documenso_Token', description: 'Credential for Documenso' }],
    sources: [{ key: 'webhook', path: '/hooks/documenso', verify: 'hmac', event: 'documenso.webhook_received', dedupe: '/providerEventId' }],
    actions: ['documenso.create', 'documenso.status', 'documenso.cancel', 'documenso.fetch_signed'], health: 'documenso.api',
  })],
});
