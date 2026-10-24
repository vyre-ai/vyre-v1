// mail (lane L5): mailboxes, Gmail/Graph/IMAP sync, the single send API (mail.send), drafts, inbound routes,
// sending domains with SPF/DKIM/DMARC checks, shared inboxes. Spec 2.18 (Sending, Message status), 2.19, 2.10 (mail sync).
// DECISION: events for email are `mail.received` plus the spec names message.sent/delivered/bounced/complained.
// Spec 2.18 calls the inbound event `message.received`, but the chat module already declares `message.received`
// (ARCHITECTURE 6.1), so email uses `mail.received` and SMS uses `sms.received` (telephony).
// DECISION: telephony.send_sms emits the same message.sent/message.bounced events with channel 'sms'.
// DECISION: message-level capabilities bind to the Space resource and rely on the mail_message row ACL (mailbox
// access, filed-record access, private flag) because one message can sit in several inboxes.
// NOT EXPRESSIBLE: the mail_message row ACL spans several mailboxes (inboxIds) plus the linked record; EntityDef.acl
// names one parent field, so `mailboxId` is the primary mailbox and the extra visibility rules live in the handler.
// DECISION: snippets and templates for the composer belong to the templates and email-builder-api modules.
import { defineManifest, entity, ev, health, outward, read, screen, setting, t, write } from '../packages/contracts/src/index.ts';
import { email, id, pageIn, pageOut } from './_common.ts';

const emlId = t.id('eml');
const cnvId = t.id('cnv');
const rteId = t.id('rte');
const recipient = t.obj({ address: email, name: t.opt(t.str()), contactId: t.opt(id.record) });
const mailboxKind = t.enm('personal', 'shared', 'agent', 'service');
const provider = t.enm('google', 'microsoft', 'imap', 'inbound_only');
const privacy = t.enm('private', 'space', 'people');
const mboxState = t.enm('pending', 'syncing', 'paused', 'error', 'disconnected');
const msgStatus = t.enm('draft', 'queued', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'received');
const dnsState = t.enm('pass', 'fail', 'pending');
const sendProvider = t.enm('resend', 'mailgun');

const mailboxRow = t.obj({
  id: id.mailbox, kind: mailboxKind, address: email, title: t.str(), ownerId: t.opt(id.user), agentId: t.opt(id.agent), provider, privacy,
  state: mboxState, lastSyncAt: t.opt(t.ts()),
});
const messageRow = t.obj({
  id: emlId, mailboxId: id.mailbox, inboxIds: t.arr(id.mailbox), threadId: t.str(), direction: t.enm('in', 'out'), status: msgStatus,
  from: recipient, to: t.arr(recipient), cc: t.arr(recipient), subject: t.str(), snippet: t.str(), sentAt: t.ts(), contactId: t.opt(id.record),
  isPrivate: t.bool(), campaignId: t.opt(id.campaign), draftedByAgent: t.opt(id.agent),
});
const messageDetail = t.obj({
  message: messageRow, text: t.opt(t.str()), html: t.opt(t.str()),
  attachments: t.arr(t.obj({ attachmentId: t.str(), name: t.str(), mime: t.str(), size: t.int(), fileId: t.opt(id.file) })),
  provider: t.obj({ providerId: t.opt(t.str()), dns: t.opt(t.obj({ spf: dnsState, dkim: dnsState, dmarc: dnsState })), traceId: id.trace }),
});
const dnsRecord = t.obj({ purpose: t.enm('spf', 'dkim', 'dmarc', 'mx', 'verify'), type: t.enm('TXT', 'CNAME', 'MX'), name: t.str(), value: t.str(), state: dnsState });
const domainRow = t.obj({ id: id.domain, name: t.str({ examples: ['mail.example.com'] }), provider: sendProvider, spf: dnsState, dkim: dnsState, dmarc: dnsState, verified: t.bool(), isDefault: t.bool(), checkedAt: t.opt(t.ts()) });
const routeRow = t.obj({ id: rteId, domainId: id.domain, localPart: t.str({ examples: ['hello'] }), mailboxId: id.mailbox, provider: sendProvider });
const composed = {
  to: t.arr(recipient, { minItems: 1 }), cc: t.opt(t.arr(recipient)), bcc: t.opt(t.arr(recipient)), subject: t.str(),
  text: t.opt(t.str()), html: t.opt(t.str()), attachments: t.opt(t.arr(id.file)),
  replyToMessageId: t.opt(emlId), contactId: t.opt(id.record), campaignId: t.opt(id.campaign), draftId: t.opt(emlId),
};
const healthOut = { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()) };

export default defineManifest({
  id: 'mail',
  title: 'Mail',
  owner: 'L5',
  entities: [
    entity('mailbox', 'mail_mailbox', 'mbx_', {
      kind: 'choice', address: 'email', title: 'text', ownerId: 'person', agentId: 'text', provider: 'choice', privacy: 'choice', state: 'status',
      connectionId: 'text', lastSyncAt: 'datetime', paused: 'checkbox',
    }, 'mailbox', { ownerField: 'ownerId', sync: { protectedFields: ['privacy', 'state'] } }),
    entity('mail_message', 'mail_message', 'eml_', {
      mailboxId: 'text', inboxIds: 'text', providerId: 'text', rfcMessageId: 'text', threadId: 'text', direction: 'choice', status: 'status',
      fromAddress: 'email', toAddresses: 'text', ccAddresses: 'text', subject: 'text', snippet: 'text',
      body: { type: 'longtext', label: 'confidential' }, sentAt: 'datetime', contactId: 'text', isPrivate: 'checkbox', campaignId: 'text',
      attachments: 'files', draftedByAgent: 'text', traceId: 'text',
    }, 'mailbox', {
      parent: { entity: 'mailbox', field: 'mailboxId' }, parentField: 'mailboxId', fts: ['subject', 'snippet', 'body'],
      sync: { profile: { desktop: 'window', phone: 'window', web: 'window' }, window: { days: 90, recentCount: 500 }, maxLabel: 'confidential', protectedFields: ['isPrivate'] },
    }),
    entity('sending_domain', 'mail_domain', 'dom_', {
      name: 'text', provider: 'choice', spf: 'choice', dkim: 'choice', dmarc: 'choice', verified: 'checkbox', isDefault: 'checkbox', records: 'longtext', checkedAt: 'datetime',
    }, 'domain', { sync: { profile: { desktop: 'none', phone: 'none', web: 'none' } } }),
    entity('inbound_route', 'mail_route', 'rte_', { domainId: 'text', localPart: 'text', mailboxId: 'text', provider: 'choice' }, 'domain', {
      parentField: 'domainId', sync: { profile: { desktop: 'none', phone: 'none', web: 'none' } },
    }),
  ],
  events: [
    ev('mail.received', 'An email arrived in a mailbox (deduped across inboxes)', {
      p: { messageId: emlId, mailboxId: id.mailbox, from: email, subject: t.str(), contactId: t.opt(id.record), campaignId: t.opt(id.campaign) },
      subject: ['mailbox', '/mailboxId'], label: 'subject', redact: ['/subject'], trigger: { title: 'An email arrives', fields: ['/mailboxId', '/from', '/campaignId'] },
    }),
    ev('message.sent', 'A message left the Space (email or text)', {
      p: { messageId: t.str(), channel: t.enm('email', 'sms'), mailboxId: t.opt(id.mailbox), contactId: t.opt(id.record), campaignId: t.opt(id.campaign) },
      subject: ['entity', '/messageId'], label: 'subject', replay: 'stub',
    }),
    ev('message.delivered', 'The provider reports delivery', { p: { messageId: t.str(), channel: t.enm('email', 'sms') }, subject: ['entity', '/messageId'], replay: 'stub' }),
    ev('message.bounced', 'A message bounced or could not be delivered', {
      p: { messageId: t.str(), channel: t.enm('email', 'sms'), address: t.str(), kind: t.enm('hard', 'soft'), reason: t.opt(t.str()) },
      subject: ['entity', '/messageId'], replay: 'stub', trigger: { title: 'A message bounces', fields: ['/channel', '/kind'] },
    }),
    ev('message.complained', 'The recipient marked a message as spam', { p: { messageId: t.str(), channel: t.enm('email', 'sms'), address: t.str() }, subject: ['entity', '/messageId'], replay: 'stub' }),
    ev('message.opened', 'A recipient opened an email', { p: { messageId: t.str() }, subject: ['entity', '/messageId'], replay: 'stub' }),
    ev('message.clicked', 'A recipient clicked a link in an email', { p: { messageId: t.str(), url: t.opt(t.str()) }, subject: ['entity', '/messageId'], replay: 'stub' }),
    ev('message.failed', 'A send failed before reaching the provider', { p: { messageId: t.str(), channel: t.enm('email', 'sms'), reason: t.str() }, subject: ['entity', '/messageId'], replay: 'stub' }),
    ev('message.suppressed', 'A send was refused for a suppressed address or missing consent', {
      p: { channel: t.enm('email', 'sms'), address: t.str(), reason: t.str(), campaignId: t.opt(id.campaign) }, subject: ['entity', '/address'],
    }),
    ev('mail_draft.saved', 'A draft was created or changed (an agent draft carries a Gate line)', {
      p: { draftId: emlId, mailboxId: id.mailbox, byAgent: t.opt(id.agent), contactId: t.opt(id.record) }, subject: ['entity', '/draftId'], label: 'subject',
    }),
    ev('mail_draft.discarded', 'A draft was discarded', { p: { draftId: emlId }, subject: ['entity', '/draftId'] }),
    ev('mailbox.created', 'A shared, agent or service mailbox was created', { p: { mailboxId: id.mailbox, kind: mailboxKind, address: email }, subject: ['mailbox', '/mailboxId'] }),
    ev('mailbox.connected', 'A mailbox connection was created (Pending until the first sync); one notice per member', {
      p: { mailboxId: id.mailbox, memberId: t.opt(id.user), provider, auto: t.bool() }, subject: ['mailbox', '/mailboxId'], vis: 'participants',
    }),
    ev('mailbox.paused', 'The owner paused a mailbox; filing stops', { p: { mailboxId: id.mailbox }, subject: ['mailbox', '/mailboxId'], vis: 'participants' }),
    ev('mailbox.resumed', 'The owner resumed a mailbox', { p: { mailboxId: id.mailbox }, subject: ['mailbox', '/mailboxId'], vis: 'participants' }),
    ev('mailbox.privacy_changed', 'A mailbox moved between private, shared with the Space and shared with chosen people', {
      p: { mailboxId: id.mailbox, privacy }, subject: ['mailbox', '/mailboxId'], vis: 'participants',
    }),
    ev('mailbox.disconnected', 'A mailbox connection was removed', { p: { mailboxId: id.mailbox }, subject: ['mailbox', '/mailboxId'], vis: 'participants' }),
    ev('mailbox.sync_completed', 'A mailbox sync finished', { p: { mailboxId: id.mailbox, received: t.int(), sent: t.int() }, subject: ['mailbox', '/mailboxId'], vis: 'participants' }),
    ev('mailbox.sync_failed', 'A mailbox sync failed; the owner sees the next step', { p: { mailboxId: id.mailbox, reason: t.str() }, subject: ['mailbox', '/mailboxId'], vis: 'participants', notify: 'sync.attention' }),
    ev('sending_domain.added', 'A sending domain was added', { p: { domainId: id.domain, name: t.str(), provider: sendProvider }, subject: ['domain', '/domainId'] }),
    ev('sending_domain.checked', 'SPF, DKIM and DMARC were checked', { p: { domainId: id.domain, spf: dnsState, dkim: dnsState, dmarc: dnsState }, subject: ['domain', '/domainId'] }),
    ev('sending_domain.removed', 'A sending domain was removed', { p: { domainId: id.domain, name: t.str() }, subject: ['domain', '/domainId'] }),
    ev('inbound_route.saved', 'An inbound route was set', { p: { routeId: rteId, domainId: id.domain, localPart: t.str(), mailboxId: id.mailbox }, subject: ['domain', '/domainId'] }),
    ev('inbound_route.removed', 'An inbound route was removed', { p: { routeId: rteId, domainId: id.domain }, subject: ['domain', '/domainId'] }),
  ],
  capabilities: [
    // ---- mailboxes
    read('mail.mailbox.list', 'List mailboxes the caller can see (own, shared with the Space, agent and service mailboxes)', {
      in: { scope: t.opt(t.enm('mine', 'shared', 'all')), kind: t.opt(mailboxKind), ...pageIn }, out: { mailboxes: t.arr(mailboxRow), ...pageOut }, tool: 'inbox', label: 'filter',
    }),
    read('mail.mailbox.get', 'Read one mailbox with its sync state', { in: { mailboxId: id.mailbox }, out: { mailbox: mailboxRow }, on: ['mailbox', '/mailboxId'], tool: 'inbox', label: 'check' }),
    write('mail.mailbox.create', 'Create a shared, agent or service mailbox (hello@, support@, an agent address)', {
      in: { kind: t.enm('shared', 'agent', 'service'), address: email, title: t.str(), agentId: t.opt(id.agent), provider: t.opt(provider), privacy: t.opt(privacy) },
      out: { mailbox: mailboxRow }, perm: 'connectors.manage', emits: ['mailbox.created'], idem: 'key', tool: 'inbox', errors: ['validation.duplicate'],
    }),
    write('mail.mailbox.update', 'Rename a mailbox or change its agent', {
      in: { mailboxId: id.mailbox, title: t.opt(t.str()), agentId: t.opt(id.agent) }, out: { mailbox: mailboxRow }, on: ['mailbox', '/mailboxId'], level: 'manage', tool: 'inbox',
    }),
    write('mail.mailbox.set_privacy', 'Mark a mailbox private, shared with the Space or shared with chosen people', {
      in: { mailboxId: id.mailbox, privacy }, out: { mailbox: mailboxRow }, on: ['mailbox', '/mailboxId'], level: 'manage', emits: ['mailbox.privacy_changed'], audit: 'always', tool: 'inbox',
    }),
    write('mail.mailbox.pause', 'Pause a mailbox connection; filing and sync stop', { in: { mailboxId: id.mailbox }, out: { mailbox: mailboxRow }, on: ['mailbox', '/mailboxId'], level: 'manage', emits: ['mailbox.paused'], audit: 'always', tool: 'inbox' }),
    write('mail.mailbox.resume', 'Resume a paused mailbox connection', { in: { mailboxId: id.mailbox }, out: { mailbox: mailboxRow }, on: ['mailbox', '/mailboxId'], level: 'manage', emits: ['mailbox.resumed'], audit: 'always', tool: 'inbox' }),
    write('mail.mailbox.disconnect', 'Remove a mailbox connection (mail already filed to records stays)', {
      in: { mailboxId: id.mailbox }, out: { disconnected: t.bool() }, on: ['mailbox', '/mailboxId'], level: 'manage', emits: ['mailbox.disconnected'], audit: 'always', tool: 'inbox',
      gate: { act: 'delete', when: "actor.kind != 'person'" },
    }),
    write('mail.connect', "Connect the caller's own mailbox: Gmail, Outlook or IMAP (member impersonation for Google and Graph, app password handle for IMAP)", {
      in: {
        provider: t.enm('google', 'microsoft', 'imap'), address: email, privacy: t.opt(privacy),
        imap: t.opt(t.obj({ host: t.str(), port: t.int(), secure: t.bool(), username: t.str(), passwordHandle: id.handle })),
      },
      out: { mailbox: mailboxRow }, emits: ['mailbox.connected'], idem: 'key', tool: 'inbox', offline: 'online', errors: ['provider.auth_failed', 'validation.duplicate'],
    }),
    write('mail.auto_connect_members', 'Create Pending mail connections for every mapped member when delegation is set and auto-connect is on (one notice each)', {
      in: { provider: t.enm('google', 'microsoft'), members: t.arr(t.obj({ userId: id.user, email })) },
      out: { created: t.int(), notified: t.int(), skipped: t.int() }, perm: 'connectors.manage', emits: ['mailbox.connected'], idem: 'key', audit: 'always',
    }),
    write('mail.sync_now', 'Sync a mailbox now', {
      in: { mailboxId: id.mailbox }, out: { runId: id.run }, on: ['mailbox', '/mailboxId'], level: 'use', emits: ['mailbox.sync_completed', 'mailbox.sync_failed'],
      run: { kind: 'mail_sync', stoppable: true }, tool: 'inbox', idem: 'natural',
    }),
    read('mail.health', 'Mail sync health: age of the last successful sync per mailbox (worst state wins)', {
      in: { mailboxId: t.opt(id.mailbox) }, out: healthOut,
    }),
    // ---- messages
    read('mail.message.get', 'Read one message with attachments, provider id, DNS check state and trace id', { in: { messageId: emlId }, out: messageDetail, tool: 'inbox', label: 'check' }),
    read('mail.message.list', 'List messages of a mailbox, thread or contact', {
      in: { mailboxId: t.opt(id.mailbox), threadId: t.opt(t.str()), contactId: t.opt(id.record), status: t.opt(msgStatus), ...pageIn }, out: { messages: t.arr(messageRow), ...pageOut }, tool: 'inbox', label: 'filter',
    }),
    read('mail.message.search', 'Search mail by text, sender, date and mailbox', {
      in: { q: t.str(), mailboxId: t.opt(id.mailbox), from: t.opt(t.ts()), to: t.opt(t.ts()), ...pageIn }, out: { messages: t.arr(messageRow), ...pageOut }, tool: 'inbox', label: 'filter',
    }),
    write('mail.message.set_private', 'Mark a message private so it stays out of the record, or clear the mark (inbox owner only)', {
      in: { messageId: emlId, isPrivate: t.bool() }, out: { message: messageRow }, tool: 'inbox', audit: 'always', offline: 'patch',
    }),
    write('mail.attachment.save', 'Save an attachment into Files', {
      in: { messageId: emlId, attachmentId: t.str(), folderId: t.opt(id.folder) }, out: { fileId: id.file }, tool: 'inbox', idem: 'key',
    }),
    // ---- the single send API
    read('mail.send_preview', 'Dry run of a send: suppressed recipients, window, caps and throttle, without sending (campaign launch preview uses it)', {
      in: { mailboxId: id.mailbox, channel: t.opt(t.enm('email')), to: t.arr(recipient, { minItems: 1 }), campaignId: t.opt(id.campaign) },
      out: {
        allowed: t.arr(email), suppressed: t.arr(t.obj({ address: email, reason: t.str() })), outsideWindow: t.arr(email),
        capRemainingToday: t.opt(t.int()), nextWindowAt: t.opt(t.ts()), providerRoute: t.enm('mailbox', 'space_domain'),
      },
      on: ['mailbox', '/mailboxId'], level: 'use', tool: 'inbox',
    }),
    outward('mail.send', 'Send an email through the single send API: caps per sender, send windows, throttling, suppression, consent, trace id header, agent footer line', {
      in: {
        mailboxId: id.mailbox, route: t.opt(t.enm('mailbox', 'space_domain')), ...composed, sendAt: t.opt(t.ts()),
      },
      out: { messageId: t.opt(emlId), status: t.enm('queued', 'sent', 'held', 'suppressed'), taskId: t.opt(id.task), suppressed: t.arr(email) },
      on: ['mailbox', '/mailboxId'], level: 'use', gate: 'send', emits: ['message.sent', 'message.suppressed', 'message.failed'], tool: 'inbox', offline: 'queue', cli: 'vyre mail send',
      errors: ['permission.needs_approval', 'validation.precondition_failed', 'rate_limit.exceeded', 'provider.auth_failed', 'provider.rate_limited', 'permission.above_clearance'],
      ex: { input: { idempotencyKey: 'idem_1', mailboxId: 'mbx_a1b2c3', to: [{ address: 'maya@example.com' }], subject: 'Hello', text: 'Hi Maya' }, output: { messageId: 'eml_a1b2c3', status: 'queued', suppressed: [] } },
    }),
    // DECISION: shared-inbox sends need comms.shared_send and agent sends need comms.agent_send; the handler checks the key
    // that matches the sender because a capability carries one permission field.
    outward('mail.send_as', "Send through a member's own Gmail, Graph or IMAP mailbox (replies go out from the inbox the thread came in on)", {
      in: { mailboxId: id.mailbox, ...composed }, out: { messageId: emlId, providerId: t.opt(t.str()) },
      on: ['mailbox', '/mailboxId'], level: 'use', gate: 'send', emits: ['message.sent', 'message.failed'], errors: ['provider.auth_failed', 'provider.rate_limited'],
    }),
    write('mail.draft', 'Create or update a draft (an agent draft waits for Send, Edit or Discard with a Gate line)', {
      in: { mailboxId: id.mailbox, ...composed, to: t.opt(t.arr(recipient)), subject: t.opt(t.str()) },
      out: { draftId: emlId, gateLine: t.opt(t.str({ description: 'Why a send of this draft will be held for approval' })) },
      on: ['mailbox', '/mailboxId'], level: 'use', emits: ['mail_draft.saved'], idem: 'key', tool: 'inbox', offline: 'queue',
    }),
    read('mail.drafts.list', 'List drafts for a mailbox or contact', {
      in: { mailboxId: t.opt(id.mailbox), contactId: t.opt(id.record), ...pageIn }, out: { drafts: t.arr(messageRow), ...pageOut }, tool: 'inbox', label: 'filter',
    }),
    write('mail.drafts.discard', 'Discard a draft', { in: { draftId: emlId }, out: { discarded: t.bool() }, emits: ['mail_draft.discarded'], tool: 'inbox', offline: 'queue' }),
    // ---- inbound and status (system)
    write('mail.ingest', 'Land one inbound or synced message: dedupe on provider id, one record across inboxes, link to a contact (sure matches link, unsure go to Needs you)', {
      in: {
        source: t.enm('google', 'microsoft', 'imap', 'resend', 'mailgun'), mailboxId: t.opt(id.mailbox), envelopeTo: t.opt(email), providerId: t.str(), rfcMessageId: t.str(),
        threadKey: t.opt(t.str()), direction: t.opt(t.enm('in', 'out')), from: recipient, to: t.arr(recipient), cc: t.opt(t.arr(recipient)), subject: t.str(),
        text: t.opt(t.str()), html: t.opt(t.str()), receivedAt: t.ts(),
        attachments: t.opt(t.arr(t.obj({ name: t.str(), mime: t.str(), size: t.int(), blobId: id.blob }))), headers: t.opt(t.rec(t.str())),
      },
      out: { messageId: emlId, deduped: t.bool(), linked: t.enm('sure', 'unsure', 'none'), contactId: t.opt(id.record), conversationId: t.opt(cnvId), taskId: t.opt(id.task) },
      emits: ['mail.received'], idem: 'natural', offline: 'online',
    }),
    write('mail.status_update', 'Apply a provider status (delivered, bounced, complained, opened, clicked, failed); hard bounces and complaints write the suppression list', {
      in: {
        providerId: t.str(), status: t.enm('delivered', 'bounced', 'complained', 'opened', 'clicked', 'failed'), kind: t.opt(t.enm('hard', 'soft')),
        reason: t.opt(t.str()), address: t.opt(t.str()), url: t.opt(t.str()), at: t.ts(),
      },
      out: { messageId: t.opt(emlId), suppressed: t.bool() },
      emits: ['message.delivered', 'message.bounced', 'message.complained', 'message.opened', 'message.clicked', 'message.failed'], idem: 'natural',
    }),
    // ---- sending domains and inbound routes
    read('mail.domain.list', 'List sending domains with SPF, DKIM and DMARC state', { in: { ...pageIn }, out: { domains: t.arr(domainRow), ...pageOut }, tool: 'inbox' }),
    read('mail.domain.get', 'Read one sending domain with the DNS records to publish', {
      in: { domainId: id.domain }, out: { domain: domainRow, records: t.arr(dnsRecord) }, on: ['domain', '/domainId'], tool: 'inbox',
    }),
    write('mail.domain.add', 'Add a sending domain at Resend or Mailgun and return the DNS records to publish', {
      in: { name: t.str({ examples: ['mail.example.com'] }), provider: sendProvider }, out: { domain: domainRow, records: t.arr(dnsRecord) },
      perm: 'comms.domains', emits: ['sending_domain.added'], idem: 'key', tool: 'inbox', errors: ['validation.duplicate', 'provider.auth_failed'],
    }),
    write('mail.domain.check', 'Re-check SPF, DKIM and DMARC for a domain (mailauth) and ask the provider to verify', {
      in: { domainId: id.domain }, out: { domain: domainRow, records: t.arr(dnsRecord) }, on: ['domain', '/domainId'], perm: 'comms.domains', emits: ['sending_domain.checked'], tool: 'inbox',
    }),
    write('mail.domain.set_default', 'Make a verified domain the default sender for Space sending', {
      in: { domainId: id.domain }, out: { domain: domainRow }, on: ['domain', '/domainId'], perm: 'comms.domains', tool: 'inbox', errors: ['validation.precondition_failed'],
    }),
    write('mail.domain.remove', 'Remove a sending domain', {
      in: { domainId: id.domain }, out: { removed: t.bool() }, on: ['domain', '/domainId'], perm: 'comms.domains', emits: ['sending_domain.removed'], audit: 'always',
      gate: { act: 'delete', when: "actor.kind != 'person'" }, tool: 'inbox',
    }),
    read('mail.route.list', 'List inbound routes (address on a Space domain to a mailbox)', { in: { domainId: t.opt(id.domain), ...pageIn }, out: { routes: t.arr(routeRow), ...pageOut }, tool: 'inbox' }),
    write('mail.route.set', 'Route an address on a Space domain (MX on the Space domain) to a mailbox through /hooks/mail', {
      in: { domainId: id.domain, localPart: t.str({ description: 'hello, support or * for the catch-all' }), mailboxId: id.mailbox }, out: { route: routeRow },
      on: ['domain', '/domainId'], perm: 'comms.domains', emits: ['inbound_route.saved'], idem: 'key', tool: 'inbox',
    }),
    write('mail.route.remove', 'Remove an inbound route', {
      in: { routeId: rteId, domainId: id.domain }, out: { removed: t.bool() }, on: ['domain', '/domainId'], perm: 'comms.domains', emits: ['inbound_route.removed'], tool: 'inbox',
    }),
  ],
  health: [
    health('mail.sync', 'Mailbox sync', 'mail.health', 'Open the mailbox, check the Google or Microsoft connection and press Sync now.', { pauses: ['sync'] }),
  ],
  screens: [
    screen('mail.domains', 'console', 'ui:SendingDomains', {
      q: { domains: ['mail.domain.list', {}, true] },
      a: { add: ['mail.domain.add', { name: '/state/name', provider: '/state/provider' }], check: ['mail.domain.check', { domainId: '/state/domainId' }], default: ['mail.domain.set_default', { domainId: '/state/domainId' }], remove: ['mail.domain.remove', { domainId: '/state/domainId' }, 'Remove this sending domain?'] },
      empty: 'No sending domain yet', primary: 'Add a domain', needs: ['comms.domains'],
    }),
    screen('mail.shared-inboxes', 'console', 'ui:SharedInboxes', {
      q: { mailboxes: ['mail.mailbox.list', { scope: '/state/scope', kind: '/state/kind' }, true], routes: ['mail.route.list', { domainId: '/state/domainId' }, true] },
      a: { create: ['mail.mailbox.create', { kind: '/state/kind', address: '/state/address', title: '/state/title' }], route: ['mail.route.set', { domainId: '/state/domainId', localPart: '/state/localPart', mailboxId: '/state/mailboxId' }], privacy: ['mail.mailbox.set_privacy', { mailboxId: '/state/mailboxId', privacy: '/state/privacy' }] },
      empty: 'No shared inboxes yet', primary: 'New shared inbox', needs: ['connectors.manage'],
    }),
    screen('mail.connections', 'settings', 'ui:MailConnections', {
      q: { mailboxes: ['mail.mailbox.list', { scope: '/state/scope' }, true] },
      a: {
        connect: ['mail.connect', { provider: '/state/provider', address: '/state/address' }], pause: ['mail.mailbox.pause', { mailboxId: '/state/mailboxId' }], resume: ['mail.mailbox.resume', { mailboxId: '/state/mailboxId' }],
        privacy: ['mail.mailbox.set_privacy', { mailboxId: '/state/mailboxId', privacy: '/state/privacy' }], sync: ['mail.sync_now', { mailboxId: '/state/mailboxId' }], disconnect: ['mail.mailbox.disconnect', { mailboxId: '/state/mailboxId' }, 'Disconnect this mailbox?'],
      },
      empty: 'No mailbox connected', primary: 'Connect a mailbox',
    }),
    screen('mail.message-detail', 'inbox', 'ui:MessageDetail', {
      slot: 'side',
      q: { message: ['mail.message.get', { messageId: '/state/messageId' }, true] },
      a: { private: ['mail.message.set_private', { messageId: '/state/messageId', isPrivate: '/state/isPrivate' }], save: ['mail.attachment.save', { messageId: '/state/messageId', attachmentId: '/state/attachmentId' }] },
      empty: 'Select a message',
    }),
  ],
  settings: [
    setting('mail.provider', 'space', 'comms', 'Space sending provider', t.enm('resend', 'mailgun'), 'resend'),
    // DECISION: the spec names caps, windows and throttling but no numbers; these are plain starting values an admin can change.
    setting('mail.sender_caps', 'space', 'comms', 'Sends per mailbox', t.obj({ perHour: t.int({ minimum: 1 }), perDay: t.int({ minimum: 1 }) }), { perHour: 30, perDay: 150 }),
    setting('mail.send_window', 'space', 'comms', 'Send window', t.obj({ days: t.arr(t.int({ minimum: 1, maximum: 7 })), startHour: t.int({ minimum: 0, maximum: 23 }), endHour: t.int({ minimum: 1, maximum: 24 }), zone: t.enm('recipient', 'space') }), { days: [1, 2, 3, 4, 5], startHour: 8, endHour: 18, zone: 'recipient' }),
    setting('mail.throttle', 'space', 'comms', 'Throttle per sending domain', t.obj({ perMinute: t.int({ minimum: 1 }) }), { perMinute: 60 }),
  ],
});
