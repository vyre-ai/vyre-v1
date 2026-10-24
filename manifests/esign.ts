// esign (lane L8): one Signature step and task kind over providers behind one interface (spec 3.6 b19, ARCH 8.4).
import { defineManifest, ev, health, outward, read, rtype, field, t, write } from '../packages/contracts/src/index.ts';
import { id } from './_common.ts';

const envelopeId = t.id('env');
const provider = t.enm('documenso', 'dropbox_sign', 'docusign');
const status = t.enm('sent', 'viewed', 'signed', 'declined', 'cancelled');
const signer = t.obj({ name: t.str(), email: t.str(), order: t.opt(t.int()) });

export default defineManifest({
  id: 'esign',
  title: 'E-signature',
  owner: 'L8',
  events: [
    ev('signature.sent', 'An envelope was sent for signature', { p: { envelopeId, recordId: t.opt(id.record), provider }, subject: ['entity', '/envelopeId'], replay: 'stub', trigger: { title: 'A document is sent for signature' } }),
    ev('signature.viewed', 'A signer opened the envelope', { p: { envelopeId, signer: t.str() }, subject: ['entity', '/envelopeId'] }),
    ev('signature.signed', 'All signers signed; the signed PDF and audit certificate were saved as a new version', { p: { envelopeId, fileId: id.file }, subject: ['entity', '/envelopeId'], trigger: { title: 'A document is signed' } }),
    ev('signature.declined', 'A signer declined', { p: { envelopeId, signer: t.str(), reason: t.opt(t.str()) }, subject: ['entity', '/envelopeId'], trigger: { title: 'A signature is declined' } }),
  ],
  recordTypes: [
    rtype('envelope', 'Envelope', 'Envelopes', 'signature', [
      field('title', 'text', 'Title', { required: true }),
      field('status', 'status', 'Status', { options: { stages: [{ key: 'sent', title: 'Sent' }, { key: 'viewed', title: 'Viewed' }, { key: 'signed', title: 'Signed' }, { key: 'declined', title: 'Declined' }] } }),
      field('provider', 'choice', 'Provider'),
      field('subject', 'relation', 'Record'),
      field('signed', 'files', 'Signed PDF'),
    ], { system: true, statusField: 'status', group: 'Documents' }),
  ],
  capabilities: [
    outward('esign.send', 'Send a file from the record folder for signature, signer fields mapped from the record', { in: { fileId: id.file, recordId: t.opt(id.record), signers: t.arr(signer), provider: t.opt(provider) }, out: { envelopeId }, on: ['file', '/fileId'], perm: 'comms.shared_send', gate: 'signature_send', emits: ['signature.sent'], tool: 'files', team: true, run: { kind: 'signature', stoppable: true } }),
    read('esign.status', 'Envelope status', { in: { envelopeId }, out: { status, signers: t.arr(t.obj({ name: t.str(), status })) }, tool: 'files' }),
    write('esign.cancel', 'Cancel an envelope', { in: { envelopeId }, out: { cancelled: t.bool() }, tool: 'files', team: true }),
    write('esign.fetch_signed', 'Fetch the signed PDF and audit certificate into the record folder as a new version', { in: { envelopeId }, out: { fileId: id.file }, emits: ['signature.signed'], tool: 'files' }),
    read('esign.list', 'List envelopes', { in: { recordId: t.opt(id.record) }, out: { envelopes: t.arr(t.obj({ envelopeId, title: t.str(), status })) }, tool: 'files' }),
    read('esign.providers', 'Providers and which is the default (Documenso, unmodified container)', { out: { providers: t.arr(t.obj({ key: provider, default: t.bool(), connected: t.bool() })) }, tool: 'files' }),
    write('esign.provider_set', 'Choose the default provider; Automations do not change', { in: { provider }, out: { ok: t.bool() }, perm: 'connectors.manage', level: 'manage', tool: 'files' }),
    write('esign.hook', 'Inbound provider webhook: sent, viewed, signed, declined', { in: { provider, payload: t.json() }, out: { ok: t.bool() }, emits: ['signature.viewed', 'signature.signed', 'signature.declined'], http: { method: 'POST', path: '/hooks/esign' }, team: true }),
    read('esign.health', 'Probe: the provider answers (Documenso container health)', { out: { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()) } }),
  ],
  health: [health('esign.documenso', 'Documenso reachable', 'esign.health', 'Restart the Documenso container in Console, Infrastructure, Services.', { pauses: ['automations'] })],
});
