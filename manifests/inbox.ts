// inbox (lane L5): the conversation model (one row per contact across email, text and calls), views, matching, following
// and the Needs a match flow. Spec 2.18 (Matching, Views, Following), 3.3, 2.23. Sending itself is mail.send and
// telephony.send_sms; mailboxes are in `mail`; calls are in `telephony`.
// DECISION: the "Calls only" view is telephony.call.list; inbox keeps no second call list.
// DECISION: follow itself is `follows.toggle` in spaces. inbox adds the per-contact "Alert me on replies" option and
// the reasons a contact reaches your Inbox (owner, project, follow, campaign, shared inbox).
// DECISION: inbox.thread takes a conversationId or a contactId (the record Conversation tab); the handler requires one of them.
// An unmatched conversation has no contact: its ACL falls back to the mailbox it arrived in (acl.fallback).
import { bindInputs, defineManifest, entity, ev, read, screen, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut } from './_common.ts';

const cnvId = t.id('cnv');
const channel = t.enm('email', 'sms', 'call');
const contactOrCompany = t.enm('contact', 'company');
const conversationRow = t.obj({
  id: cnvId, contactId: t.opt(id.record), address: t.str({ description: 'Email, number or handle when no contact is matched', examples: ['maya@example.com'] }),
  displayName: t.str(), lastMessageAt: t.ts(), lastChannel: t.enm('email', 'sms', 'call', 'meeting'), lastPreview: t.str(), unreadCount: t.int({ minimum: 0 }),
  needsMatch: t.bool(), ownerId: t.opt(id.user), mailboxIds: t.arr(id.mailbox), campaignId: t.opt(id.campaign), followed: t.bool(), alertOnReplies: t.bool(),
  starred: t.opt(t.bool()),   // the caller's own flag, like followed; absent means not starred
  // Row flags the list handler fills from the contact record, its deliverability and the drafts; absent means unknown or none.
  organisation: t.opt(t.str({ examples: ['Acme Legal'] })), dnd: t.opt(t.bool()),
  bounced: t.opt(t.bool()), unmatched: t.opt(t.bool()),
  draftReady: t.opt(t.bool()),
});
const timelineItem = t.obj({
  kind: t.enm('email', 'sms', 'call', 'meeting', 'campaign_step', 'record_chip', 'note'), id: t.str(), at: t.ts(), direction: t.opt(t.enm('in', 'out')),
  title: t.opt(t.str()), preview: t.opt(t.str()), campaignId: t.opt(id.campaign), recordId: t.opt(id.record), ref: t.opt(t.json()),
});
const suggestion = t.obj({ recordId: id.record, type: contactOrCompany, name: t.str(), score: t.num({ minimum: 0, maximum: 1 }), why: t.str() });
const listFilter = {
  mailboxId: t.opt(id.mailbox), numberId: t.opt(id.number), channel: t.opt(channel), needsMatch: t.opt(t.bool()), query: t.opt(t.str()),
};

const manifest = defineManifest({
  id: 'inbox',
  title: 'Inbox',
  owner: 'L5',
  entities: [
    entity('conversation', 'inbox_conversation', 'cnv_', {
      contactId: 'text', address: 'text', displayName: 'text', lastMessageAt: 'datetime', lastChannel: 'choice', lastPreview: 'text', unreadCount: 'number',
      needsMatch: 'checkbox', ownerId: 'person', mailboxIds: 'text', numberIds: 'text', campaignId: 'text',
    }, 'record', {
      parentField: 'contactId', ownerField: 'ownerId', fallback: { resource: 'mailbox', field: 'mailboxIds' }, fts: ['displayName', 'address', 'lastPreview'],
      sync: { profile: { desktop: 'all', phone: 'window', web: 'window' }, window: { days: 90, recentCount: 300 }, protectedFields: ['needsMatch'] },
    }),
    entity('conversation_follow', 'inbox_follow', 'fol_', { contactId: 'text', principalId: 'text', alertOnReplies: 'checkbox' }, 'record', {
      parentField: 'contactId', ownerField: 'principalId',
    }),
  ],
  events: [
    ev('conversation.created', 'A conversation row was opened for a new address or contact', { p: { conversationId: cnvId, contactId: t.opt(id.record), channel }, subject: ['entity', '/conversationId'], label: 'subject' }),
    ev('conversation.matched', 'A sender was linked to a contact or company record', {
      p: { conversationId: cnvId, recordId: id.record, by: t.enm('rule', 'person', 'agent'), undoable: t.bool() }, subject: ['record', '/recordId'], label: 'subject', trigger: { title: 'A sender is matched to a record', fields: ['/by'] },
    }),
    ev('conversation.unmatched', 'A match was undone', { p: { conversationId: cnvId, recordId: id.record }, subject: ['record', '/recordId'], label: 'subject' }),
    ev('conversation.needs_match', 'An unsure sender needs a person to pick the record', { p: { conversationId: cnvId, taskId: t.opt(id.task) }, subject: ['entity', '/conversationId'] }),
    ev('conversation.reply_received', 'A followed contact replied (Alert me on replies raises it to Interrupt in working hours)', {
      p: { conversationId: cnvId, contactId: id.record, channel }, subject: ['record', '/contactId'], vis: 'participants', notify: 'reply.followed',
    }),
    ev('conversation.campaign_reply', 'A contact on a campaign replied; it lands in the owner Inbox marked with the campaign', {
      p: { conversationId: cnvId, contactId: id.record, campaignId: id.campaign, channel }, subject: ['record', '/contactId'], vis: 'participants', notify: 'campaign.reply',
    }),
    ev('conversation.follow_changed', 'A person followed or unfollowed a contact conversation', {
      p: { contactId: id.record, principalId: t.str(), following: t.bool(), alertOnReplies: t.bool() }, subject: ['record', '/contactId'], vis: 'participants',
    }),
  ],
  capabilities: [
    read('inbox.list_by_contact', 'Inbox default view: one row per person, newest message across email, text and calls', {
      in: { ...listFilter, ...pageIn }, out: { rows: t.arr(conversationRow), showing: t.str({ description: 'Plain words for the header: what is showing' }), ...pageOut },
      tool: 'inbox', label: 'filter', cli: 'vyre inbox list',
    }),
    read('inbox.list_by_thread', 'Inbox thread view: one row per email thread or text thread', {
      in: { ...listFilter, ...pageIn },
      out: { threads: t.arr(t.obj({ threadId: t.str(), channel, subject: t.opt(t.str()), mailboxId: t.opt(id.mailbox), lastAt: t.ts(), participants: t.arr(t.str()), unread: t.int(), contactId: t.opt(id.record) })), showing: t.str(), ...pageOut },
      tool: 'inbox', label: 'filter',
    }),
    read('inbox.thread', 'The whole history of one contact: emails, texts, calls, meetings, campaign lines and record chips', {
      in: { conversationId: t.opt(cnvId), contactId: t.opt(id.record), before: t.opt(t.ts()), ...pageIn }, out: { conversation: conversationRow, items: t.arr(timelineItem), ...pageOut },
      tool: 'inbox', label: 'check', errors: ['validation.bad_input'],
    }),
    read('inbox.unmatched', 'The Unmatched list: senders with no record that did not raise Needs a match', {
      in: { query: t.opt(t.str()), ...pageIn }, out: { rows: t.arr(conversationRow), ...pageOut }, tool: 'inbox', label: 'filter',
    }),
    read('inbox.needs_match', 'The Needs a match filter: unsure senders with suggested records', {
      in: { ...pageIn }, out: { rows: t.arr(t.obj({ conversation: conversationRow, suggestions: t.arr(suggestion) })), ...pageOut }, tool: 'inbox', label: 'filter',
    }),
    read('inbox.match_suggestions', 'Suggested records for one sender', { in: { conversationId: cnvId }, out: { suggestions: t.arr(suggestion) }, tool: 'inbox', label: 'filter' }),
    write('inbox.match', 'Match a sender to a contact or company record (Undo stays available)', {
      in: { conversationId: cnvId, recordId: id.record, rememberAddress: t.opt(t.bool()) },
      out: { conversation: conversationRow, undoToken: t.str() }, perm: 'records.edit', emits: ['conversation.matched'], idem: 'key', tool: 'inbox', offline: 'queue',
    }),
    write('inbox.unmatch', 'Undo a match; the sender goes back to Unmatched', {
      in: { conversationId: cnvId, undoToken: t.opt(t.str()) }, out: { conversation: conversationRow }, perm: 'records.edit', emits: ['conversation.unmatched'], tool: 'inbox', offline: 'queue',
    }),
    write('inbox.match_new', 'Create a contact or company from an unmatched sender and match it', {
      in: { conversationId: cnvId, type: contactOrCompany, name: t.opt(t.str()) }, out: { recordId: id.record, conversation: conversationRow },
      perm: 'records.create', emits: ['conversation.matched'], idem: 'key', tool: 'inbox',
    }),
    write('inbox.link_message', 'Shared linking step for a stored message, text or call: sure matches link, unsure go to Needs you, unowned replies route to the campaign owner then the shared inbox', {
      in: {
        channel, ref: t.obj({ kind: t.enm('mail_message', 'sms', 'call'), id: t.str() }), address: t.str(), direction: t.enm('in', 'out'), at: t.ts(),
        mailboxId: t.opt(id.mailbox), numberId: t.opt(id.number), campaignId: t.opt(id.campaign), preview: t.opt(t.str()),
      },
      out: { conversationId: cnvId, contactId: t.opt(id.record), linked: t.enm('sure', 'unsure', 'none'), taskId: t.opt(id.task) },
      emits: ['conversation.created', 'conversation.matched', 'conversation.needs_match', 'conversation.reply_received', 'conversation.campaign_reply'], idem: 'natural',
    }),
    read('inbox.counts', 'Unread counts for the sidebar: per inbox, per number and the Needs a match total', {
      in: {}, out: { byInbox: t.arr(t.obj({ kind: t.enm('mailbox', 'number'), id: t.str(), name: t.opt(t.str({ description: 'What the sidebar shows: the mailbox address or the number display name (telephony number displayName), never the id' })), unread: t.int() })), total: t.int(), needsMatch: t.int() }, tool: 'inbox',
    }),
    write('inbox.mark_read', 'Mark a conversation read or unread', {
      in: { conversationId: cnvId, read: t.opt(t.bool()) }, out: { conversation: conversationRow }, tool: 'inbox', offline: 'queue',
    }),
    write('inbox.follow_set', 'Follow a contact or set Alert me on replies (the follow itself is stored with stars and follows)', {
      in: { contactId: id.record, follow: t.bool(), alertOnReplies: t.opt(t.bool()) }, out: { following: t.bool(), alertOnReplies: t.bool() },
      on: ['record', '/contactId'], level: 'view', emits: ['conversation.follow_changed'], tool: 'inbox', offline: 'queue',
    }),
    read('inbox.following', 'Contacts that reach your Inbox and why: owner, project, follow, campaign or shared inbox', {
      in: { ...pageIn },
      out: { rows: t.arr(t.obj({ contactId: id.record, reasons: t.arr(t.enm('owner', 'project', 'follow', 'campaign', 'shared_inbox')), alertOnReplies: t.bool() })), ...pageOut }, tool: 'inbox', label: 'filter',
    }),
    read('inbox.send_options', 'Channels and sending inboxes for a contact; the default is the inbox the thread came in on', {
      in: { conversationId: t.opt(cnvId), contactId: t.opt(id.record) },
      out: {
        channels: t.arr(t.enm('email', 'sms')),
        inboxes: t.arr(t.obj({ kind: t.enm('mailbox', 'number'), id: t.str(), address: t.str(), canSend: t.bool(), isDefault: t.bool() })),
      },
      tool: 'inbox', label: 'check',
    }),
    read('inbox.recipients_search', 'Ranked recipient search across contacts, members, inboxes and groups (the shared Recipients field)', {
      in: { q: t.str(), kinds: t.opt(t.arr(t.enm('contact', 'member', 'inbox', 'group'))), limit: t.opt(t.int({ minimum: 1, maximum: 50 })) },
      out: { results: t.arr(t.obj({ kind: t.enm('contact', 'member', 'inbox', 'group'), id: t.str(), label: t.str(), address: t.opt(t.str()), score: t.num() })) }, tool: 'inbox', label: 'filter',
    }),
  ],
  screens: [
    screen('inbox.sidebar', 'inbox', 'ui:InboxSidebar', {
      slot: 'sidebar',
      q: { counts: ['inbox.counts', {}, true], mailboxes: ['mail.mailbox.list', { scope: '/state/scope' }, true], calendars: ['calendar.list_calendars', {}, true] },
      empty: 'No inbox connected', primary: 'Connect a mailbox',
    }),
    screen('inbox.contact-list', 'inbox', 'ui:InboxContactList', {
      q: {
        rows: ['inbox.list_by_contact', { mailboxId: '/state/mailboxId', numberId: '/state/numberId', channel: '/state/channel', needsMatch: '/state/needsMatch', query: '/state/query' }, true],
        threads: ['inbox.list_by_thread', { mailboxId: '/state/mailboxId', numberId: '/state/numberId', channel: '/state/channel', needsMatch: '/state/needsMatch', query: '/state/query' }, true],
        calls: ['telephony.call.list', { numberId: '/state/numberId' }, true],
      },
      a: { read: ['inbox.mark_read', { conversationId: '/state/conversationId', read: '/state/read' }], follow: ['inbox.follow_set', { contactId: '/state/contactId', follow: '/state/follow' }] },
      empty: 'No conversations yet',
    }),
    screen('inbox.contact-tab', 'inbox', 'ui:InboxContactTab', {
      slot: 'tab',
      q: {
        thread: ['inbox.thread', { conversationId: '/state/conversationId', contactId: '/state/contactId' }, true],
        options: ['inbox.send_options', { conversationId: '/state/conversationId', contactId: '/state/contactId' }, true],
        drafts: ['mail.drafts.list', { contactId: '/state/contactId' }, true],
      },
      a: {
        email: ['mail.send', { mailboxId: '/state/mailboxId', to: '/state/to', cc: '/state/cc', bcc: '/state/bcc', subject: '/state/subject', text: '/state/text', html: '/state/html', replyToMessageId: '/state/replyToMessageId', draftId: '/state/draftId' }],
        text: ['telephony.send_sms', { numberId: '/state/numberId', to: '/state/to', body: '/state/body', contactId: '/state/contactId' }],
        call: ['telephony.dial', { numberId: '/state/numberId', to: '/state/to', contactId: '/state/contactId' }],
        discard: ['mail.drafts.discard', { draftId: '/state/draftId' }],
        follow: ['inbox.follow_set', { contactId: '/state/contactId', follow: '/state/follow', alertOnReplies: '/state/alertOnReplies' }],
        read: ['inbox.mark_read', { conversationId: '/state/conversationId' }],
      },
      empty: 'No messages with this contact yet',
    }),
    screen('inbox.unmatched', 'inbox', 'ui:InboxUnmatched', {
      q: { rows: ['inbox.unmatched', { query: '/state/query' }, true], needs: ['inbox.needs_match', {}, true], suggestions: ['inbox.match_suggestions', { conversationId: '/state/conversationId' }, true] },
      a: {
        match: ['inbox.match', { conversationId: '/state/conversationId', recordId: '/state/recordId' }],
        undo: ['inbox.unmatch', { conversationId: '/state/conversationId', undoToken: '/state/undoToken' }],
        create: ['inbox.match_new', { conversationId: '/state/conversationId', type: '/state/type' }],
      },
      empty: 'Nothing waiting for a match',
    }),
  ],
});

export default { ...manifest, capabilities: bindInputs(manifest.capabilities ?? [], { conversationId: { row: 'conversation' } }) };
