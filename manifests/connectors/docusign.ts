// docusign (lane L8): e-signature provider behind the EsignProvider interface (spec 3.6 b19, ARCH 8.4).
import { conn, defineManifest, ev, health, read, t, write } from '../../packages/contracts/src/index.ts';
import { id } from '../_common.ts';

const envelope = t.str({ examples: ['env_a1b2c3'] });

export default defineManifest({
  id: 'docusign',
  title: 'DocuSign',
  kind: 'connector',
  owner: 'L8',
  events: [
    ev('docusign.webhook_received', 'A DocuSign webhook arrived and was verified', { p: { providerEventId: t.str(), envelopeId: envelope, status: t.str() }, subject: ['entity', '/envelopeId'] }),
  ],
  capabilities: [
    write('docusign.create', 'Create an envelope at DocuSign', { in: { fileId: id.file, signers: t.arr(t.obj({ name: t.str(), email: t.str() })) }, out: { remoteId: t.str() }, perm: 'connectors.manage', team: true }),
    read('docusign.status', 'Envelope status at DocuSign', { in: { remoteId: t.str() }, out: { status: t.str() } }),
    write('docusign.cancel', 'Cancel an envelope at DocuSign', { in: { remoteId: t.str() }, out: { cancelled: t.bool() }, perm: 'connectors.manage', team: true }),
    read('docusign.fetch_signed', 'Download the signed PDF and audit certificate from DocuSign', { in: { remoteId: t.str() }, out: { fileId: id.file } }),
    read('docusign.health', 'Probe: the DocuSign account endpoint answers', { out: { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()) } }),
  ],
  health: [health('docusign.api', 'DocuSign reachable', 'docusign.health', 'Reconnect DocuSign in Console, Integrations.')],
  connectors: [conn('docusign', 'DocuSign', {
    mode: 'api', scope: 'space', auth: { type: 'oauth2', authUrl: 'https://account.docusign.com/oauth/auth', tokenUrl: 'https://account.docusign.com/oauth/token', scopes: ['signature', 'impersonation'], pkce: false },
    domains: ['*.docusign.net', 'account.docusign.com'], secrets: [{ name: 'DocuSign_Key', description: 'Credential for DocuSign' }],
    sources: [{ key: 'webhook', path: '/hooks/docusign', verify: 'hmac', event: 'docusign.webhook_received', dedupe: '/providerEventId' }],
    actions: ['docusign.create', 'docusign.status', 'docusign.cancel', 'docusign.fetch_signed'], health: 'docusign.api',
  })],
});
