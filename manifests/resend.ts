// resend (lane L5): Resend connector, one of the two `send.email` backends for Space sending (campaigns, automations,
// agents, shared inboxes). Domains with SPF/DKIM/DMARC records, delivery webhooks, inbound routes. ARCHITECTURE 8 table, 8.2.
// DECISION: mail.send is the only door for sending. resend.send_email has no MCP tool; people and agents call mail.send,
// which applies caps, windows, throttling, suppression and the Gate before it reaches this backend.
// DECISION: inbound routes arrive at /hooks/mail/resend (the shared /hooks/mail pipeline with a provider suffix) so each
// connector owns a distinct source path.
import { conn, defineManifest, ev, health, outward, read, t, write } from '../packages/contracts/src/index.ts';
import { email, id } from './_common.ts';

const healthOut = { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()) };
const dnsState = t.enm('pass', 'fail', 'pending');
const dnsRecord = t.obj({ purpose: t.enm('spf', 'dkim', 'dmarc', 'mx', 'verify'), type: t.enm('TXT', 'CNAME', 'MX'), name: t.str(), value: t.str(), state: dnsState });
const domainRow = t.obj({ providerDomainId: t.str(), name: t.str(), status: t.enm('not_started', 'pending', 'verified', 'failed'), spf: dnsState, dkim: dnsState, dmarc: dnsState, region: t.opt(t.str()) });
const eventType = t.enm('sent', 'delivered', 'bounced', 'complained', 'opened', 'clicked', 'failed', 'delayed');
const quiet = (what: string) => ({ act: 'none', reason: what });

const capabilities = [
  outward('resend.send_email', 'Send one email through Resend (the send.email backend behind mail.send)', {
    in: {
      from: email, fromName: t.opt(t.str()), to: t.arr(email, { minItems: 1 }), cc: t.opt(t.arr(email)), bcc: t.opt(t.arr(email)), replyTo: t.opt(email), subject: t.str(),
      text: t.opt(t.str()), html: t.opt(t.str()), attachments: t.opt(t.arr(t.obj({ name: t.str(), fileId: id.file }))), headers: t.opt(t.rec(t.str())), tags: t.opt(t.arr(t.obj({ name: t.str(), value: t.str() }))),
    },
    out: { providerId: t.str() }, gate: 'send', errors: ['provider.auth_failed', 'provider.rate_limited', 'provider.bad_response'],
  }),
  read('resend.get_email', 'Look up the delivery status of a sent email', { in: { providerId: t.str() }, out: { status: t.str(), lastEvent: t.opt(eventType), at: t.opt(t.ts()) } }),
  read('resend.domains.list', 'List domains in the Resend account', { in: {}, out: { domains: t.arr(domainRow) }, perm: 'comms.domains' }),
  read('resend.domains.get', 'Read one domain with the DNS records to publish', { in: { providerDomainId: t.str() }, out: { domain: domainRow, records: t.arr(dnsRecord) }, perm: 'comms.domains' }),
  outward('resend.domains.create', 'Create a domain in Resend and return the DNS records for SPF, DKIM and DMARC', {
    in: { name: t.str(), region: t.opt(t.str()) }, out: { domain: domainRow, records: t.arr(dnsRecord) }, perm: 'comms.domains', gate: quiet('Adds a domain to the Space Resend account; nothing is sent to anyone'),
  }),
  outward('resend.domains.verify', 'Ask Resend to verify the published DNS records', {
    in: { providerDomainId: t.str() }, out: { domain: domainRow }, perm: 'comms.domains', gate: quiet('Asks Resend to re-check DNS; nothing is sent to anyone'),
  }),
  outward('resend.domains.delete', 'Delete a domain from Resend', { in: { providerDomainId: t.str() }, out: { deleted: t.bool() }, perm: 'comms.domains', gate: 'delete' }),
  read('resend.inbound.get_email', 'Fetch an inbound email (body and attachments) by Resend id', {
    in: { emailId: t.str() },
    out: {
      from: t.str(), to: t.arr(t.str()), subject: t.str(), text: t.opt(t.str()), html: t.opt(t.str()), messageId: t.str(), receivedAt: t.ts(),
      attachments: t.arr(t.obj({ name: t.str(), mime: t.str(), size: t.int(), blobId: id.blob })),
    },
  }),
  read('resend.health', 'Health probe: GET /domains', { in: {}, out: healthOut }),
  write('resend.receive_webhook', 'Record a verified Resend delivery event after dedupe and apply it with mail.status_update', {
    in: { eventId: t.str(), type: eventType, providerId: t.str(), address: t.opt(t.str()), bounceKind: t.opt(t.enm('hard', 'soft')), reason: t.opt(t.str()), url: t.opt(t.str()), at: t.ts() },
    out: { accepted: t.bool() }, emits: ['resend.event_received'], idem: 'natural', offline: 'online',
  }),
  write('resend.receive_inbound', 'Record a verified inbound route delivery after dedupe and land it with mail.ingest', {
    in: { emailId: t.str(), route: t.opt(t.str()) }, out: { accepted: t.bool(), messageId: t.opt(t.id('eml')) }, emits: ['resend.inbound_received'], idem: 'natural', offline: 'online',
  }),
];

export default defineManifest({
  id: 'resend',
  title: 'Resend',
  kind: 'connector',
  owner: 'L5',
  events: [
    ev('resend.event_received', 'A verified Resend delivery event arrived', { p: { eventId: t.str(), type: eventType, providerId: t.str() }, subject: ['entity', '/eventId'] }),
    ev('resend.inbound_received', 'A verified Resend inbound email arrived', { p: { emailId: t.str(), route: t.opt(t.str()) }, subject: ['entity', '/emailId'] }),
  ],
  capabilities,
  connectors: [
    conn('resend', 'Resend', {
      mode: 'api', scope: 'space', auth: { type: 'api_key', secret: 'Resend_Key' }, domains: ['api.resend.com'],
      secrets: [{ name: 'Resend_Key', description: 'Resend API key for the Space' }, { name: 'Resend_Webhook_Secret', description: 'Signing secret for /hooks/resend and /hooks/mail/resend' }],
      sources: [
        { key: 'resend', path: '/hooks/resend', verify: 'hmac', event: 'resend.event_received', dedupe: '/eventId' },
        { key: 'resend_inbound', path: '/hooks/mail/resend', verify: 'hmac', event: 'resend.inbound_received', dedupe: '/emailId' },
      ],
      actions: capabilities.map((c) => c.name), rate: { rps: 2, burst: 5 }, health: 'resend.api',
    }),
  ],
  health: [
    health('resend.api', 'Resend', 'resend.health', 'Check the Resend_Key in the Vault, then check the sending domain records in Console, Comms.', { pauses: ['sends'] }),
  ],
});
