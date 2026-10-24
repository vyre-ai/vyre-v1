// mailgun (lane L5): Mailgun connector, the other `send.email` backend. Domains, delivery events, routes for inbound
// mail. ARCHITECTURE 8 table, 8.2.
// DECISION: as with Resend, mail.send is the only door for sending; mailgun.send_email has no MCP tool.
// DECISION: the Space picks us or eu with the setting `mailgun.region`; both hosts are allowed egress domains.
// DECISION: inbound routes arrive at /hooks/mail/mailgun (shared /hooks/mail pipeline, provider suffix).
import { conn, defineManifest, ev, health, outward, read, setting, t, write } from '../packages/contracts/src/index.ts';
import { email, id } from './_common.ts';

const healthOut = { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()) };
const dnsState = t.enm('pass', 'fail', 'pending');
const dnsRecord = t.obj({ purpose: t.enm('spf', 'dkim', 'dmarc', 'mx', 'verify'), type: t.enm('TXT', 'CNAME', 'MX'), name: t.str(), value: t.str(), state: dnsState });
const domainRow = t.obj({ name: t.str(), state: t.enm('unverified', 'active', 'disabled'), spf: dnsState, dkim: dnsState, dmarc: dnsState, region: t.enm('us', 'eu') });
const eventType = t.enm('accepted', 'delivered', 'failed', 'opened', 'clicked', 'complained', 'unsubscribed');
const routeRow = t.obj({ routeId: t.str(), expression: t.str(), forwardTo: t.arr(t.str()), priority: t.int(), description: t.opt(t.str()) });
const quiet = (what: string) => ({ act: 'none', reason: what });

const capabilities = [
  outward('mailgun.send_email', 'Send one email through Mailgun (the send.email backend behind mail.send)', {
    in: {
      domain: t.str(), from: email, fromName: t.opt(t.str()), to: t.arr(email, { minItems: 1 }), cc: t.opt(t.arr(email)), bcc: t.opt(t.arr(email)), replyTo: t.opt(email), subject: t.str(),
      text: t.opt(t.str()), html: t.opt(t.str()), attachments: t.opt(t.arr(t.obj({ name: t.str(), fileId: id.file }))), headers: t.opt(t.rec(t.str())), tags: t.opt(t.arr(t.str())),
    },
    out: { providerId: t.str() }, gate: 'send', errors: ['provider.auth_failed', 'provider.rate_limited', 'provider.bad_response'],
  }),
  read('mailgun.events.list', 'List delivery events for a domain, optionally for one message', {
    in: { domain: t.str(), providerId: t.opt(t.str()), event: t.opt(eventType), since: t.opt(t.ts()), pageToken: t.opt(t.str()) },
    out: { events: t.arr(t.obj({ eventId: t.str(), event: eventType, providerId: t.opt(t.str()), address: t.opt(t.str()), at: t.ts() })), nextPageToken: t.opt(t.str()) },
  }),
  read('mailgun.domains.list', 'List domains in the Mailgun account', { in: {}, out: { domains: t.arr(domainRow) }, perm: 'comms.domains' }),
  read('mailgun.domains.get', 'Read one domain with the DNS records to publish', { in: { name: t.str() }, out: { domain: domainRow, records: t.arr(dnsRecord) }, perm: 'comms.domains' }),
  outward('mailgun.domains.create', 'Create a domain in Mailgun and return the DNS records for SPF, DKIM and DMARC', {
    in: { name: t.str(), region: t.opt(t.enm('us', 'eu')) }, out: { domain: domainRow, records: t.arr(dnsRecord) }, perm: 'comms.domains', gate: quiet('Adds a domain to the Space Mailgun account; nothing is sent to anyone'),
  }),
  outward('mailgun.domains.verify', 'Ask Mailgun to verify the published DNS records', {
    in: { name: t.str() }, out: { domain: domainRow }, perm: 'comms.domains', gate: quiet('Asks Mailgun to re-check DNS; nothing is sent to anyone'),
  }),
  outward('mailgun.domains.delete', 'Delete a domain from Mailgun', { in: { name: t.str() }, out: { deleted: t.bool() }, perm: 'comms.domains', gate: 'delete' }),
  read('mailgun.routes.list', 'List Mailgun routes', { in: {}, out: { routes: t.arr(routeRow) }, perm: 'comms.domains' }),
  outward('mailgun.routes.create', 'Create a route that forwards inbound mail for an address to /hooks/mail/mailgun', {
    in: { expression: t.str({ examples: ['match_recipient("hello@example.com")'] }), priority: t.opt(t.int()), description: t.opt(t.str()) }, out: { route: routeRow }, perm: 'comms.domains',
    gate: quiet('Adds an inbound route in the Space Mailgun account; nothing is sent to anyone'),
  }),
  outward('mailgun.routes.delete', 'Delete a Mailgun route', { in: { routeId: t.str() }, out: { deleted: t.bool() }, perm: 'comms.domains', gate: 'delete' }),
  read('mailgun.health', 'Health probe: domain verification state', { in: { domain: t.opt(t.str()) }, out: healthOut }),
  write('mailgun.receive_webhook', 'Record a verified Mailgun delivery event after dedupe and apply it with mail.status_update', {
    in: { eventId: t.str(), event: eventType, providerId: t.str(), address: t.opt(t.str()), severity: t.opt(t.enm('permanent', 'temporary')), reason: t.opt(t.str()), url: t.opt(t.str()), at: t.ts() },
    out: { accepted: t.bool() }, emits: ['mailgun.event_received'], idem: 'natural', offline: 'online',
  }),
  write('mailgun.receive_inbound', 'Record a verified inbound route delivery after dedupe and land it with mail.ingest', {
    in: { messageId: t.str(), recipient: t.str(), sender: t.str() }, out: { accepted: t.bool(), mailMessageId: t.opt(t.id('eml')) }, emits: ['mailgun.inbound_received'], idem: 'natural', offline: 'online',
  }),
];

export default defineManifest({
  id: 'mailgun',
  title: 'Mailgun',
  kind: 'connector',
  owner: 'L5',
  events: [
    ev('mailgun.event_received', 'A verified Mailgun delivery event arrived', { p: { eventId: t.str(), event: eventType, providerId: t.str() }, subject: ['entity', '/eventId'] }),
    ev('mailgun.inbound_received', 'A verified Mailgun inbound email arrived', { p: { messageId: t.str(), recipient: t.str() }, subject: ['entity', '/messageId'] }),
  ],
  capabilities,
  connectors: [
    conn('mailgun', 'Mailgun', {
      mode: 'api', scope: 'space', auth: { type: 'api_key', secret: 'Mailgun_Key' }, domains: ['api.mailgun.net', 'api.eu.mailgun.net'],
      secrets: [{ name: 'Mailgun_Key', description: 'Mailgun private API key for the Space' }, { name: 'Mailgun_Signing_Key', description: 'HTTP webhook signing key for /hooks/mailgun and /hooks/mail/mailgun' }],
      sources: [
        { key: 'mailgun', path: '/hooks/mailgun', verify: 'hmac', event: 'mailgun.event_received', dedupe: '/eventId' },
        { key: 'mailgun_inbound', path: '/hooks/mail/mailgun', verify: 'hmac', event: 'mailgun.inbound_received', dedupe: '/messageId' },
      ],
      actions: capabilities.map((c) => c.name), rate: { rps: 5, burst: 10 }, health: 'mailgun.domain',
    }),
  ],
  health: [
    health('mailgun.domain', 'Mailgun', 'mailgun.health', 'Check the Mailgun_Key in the Vault and the domain verification state in Console, Comms.', { pauses: ['sends'] }),
  ],
  settings: [
    setting('mailgun.region', 'space', 'integrations', 'Mailgun region', t.enm('us', 'eu'), 'us'),
  ],
});
