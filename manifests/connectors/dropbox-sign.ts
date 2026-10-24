// dropbox-sign (lane L8): e-signature provider behind the EsignProvider interface (spec 3.6 b19, ARCH 8.4).
import { conn, defineManifest, ev, health, read, t, write } from '../../packages/contracts/src/index.ts';
import { id } from '../_common.ts';

const envelope = t.str({ examples: ['env_a1b2c3'] });

export default defineManifest({
  id: 'dropbox-sign',
  title: 'Dropbox Sign',
  kind: 'connector',
  owner: 'L8',
  events: [
    ev('dropbox_sign.webhook_received', 'A Dropbox Sign webhook arrived and was verified', { p: { providerEventId: t.str(), envelopeId: envelope, status: t.str() }, subject: ['entity', '/envelopeId'] }),
  ],
  capabilities: [
    write('dropbox_sign.create', 'Create an envelope at Dropbox Sign', { in: { fileId: id.file, signers: t.arr(t.obj({ name: t.str(), email: t.str() })) }, out: { remoteId: t.str() }, perm: 'connectors.manage', team: true }),
    read('dropbox_sign.status', 'Envelope status at Dropbox Sign', { in: { remoteId: t.str() }, out: { status: t.str() } }),
    write('dropbox_sign.cancel', 'Cancel an envelope at Dropbox Sign', { in: { remoteId: t.str() }, out: { cancelled: t.bool() }, perm: 'connectors.manage', team: true }),
    read('dropbox_sign.fetch_signed', 'Download the signed PDF and audit certificate from Dropbox Sign', { in: { remoteId: t.str() }, out: { fileId: id.file } }),
    read('dropbox_sign.health', 'Probe: the Dropbox Sign account endpoint answers', { out: { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()) } }),
  ],
  health: [health('dropbox_sign.api', 'Dropbox Sign reachable', 'dropbox_sign.health', 'Reconnect Dropbox Sign in Console, Integrations.')],
  connectors: [conn('dropbox-sign', 'Dropbox Sign', {
    mode: 'api', scope: 'space', auth: { type: 'api_key', secret: 'DropboxSign_Key' },
    domains: ['api.hellosign.com'], secrets: [{ name: 'DropboxSign_Key', description: 'Credential for Dropbox Sign' }],
    sources: [{ key: 'webhook', path: '/hooks/dropbox-sign', verify: 'hmac', event: 'dropbox_sign.webhook_received', dedupe: '/providerEventId' }],
    actions: ['dropbox_sign.create', 'dropbox_sign.status', 'dropbox_sign.cancel', 'dropbox_sign.fetch_signed'], health: 'dropbox_sign.api',
  })],
});
