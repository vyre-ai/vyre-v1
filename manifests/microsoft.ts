// microsoft (lane L5): Microsoft 365 connector. App registration with admin consent and client credentials; application
// permissions limited by an Exchange application access policy to the mapped members. Mail, Calendar, Drive and Teams
// recordings through Graph. ARCHITECTURE 8 table and 8.1, spec 2.18, 2.10.
// DECISION: capability prefix is `ms.` (ARCHITECTURE 8 names `ms.mail.*`, `ms.calendar.*`, `ms.drive.*`, `ms.teams.recordings.*`);
// the module id is `microsoft`. Every call carries `connectionId` and an optional `as` member address (Graph /users/{id}).
// DECISION: the Exchange application access policy step cannot be run by Vyre (only a tenant admin can), so
// ms.consent.policy_snippet returns the PowerShell text for the admin to copy.
// DECISION: Graph change notifications are verified by the validationToken echo and the shared clientState value, so
// the source uses verify 'signature'.
// DECISION: gate acts follow the Google module: 'send' for anything that notifies people, 'post' for writes to files,
// 'delete' for deletes, and an explicit { act: 'none', reason } for changes that only touch the member's own data.
import { conn, defineManifest, ev, health, outward, read, screen, setting, step, t, write } from '../packages/contracts/src/index.ts';
import type { CapOpts, Props } from '../packages/contracts/src/index.ts';
import { email, id, pageIn, pageOut } from './_common.ts';

const act: Props = { connectionId: id.connection, as: t.opt(email) };
const onConn = { on: ['connection', '/connectionId'] } as const;
const quiet = (what: string) => ({ act: 'none', reason: what });
const healthOut = { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()) };
const PERMISSIONS = ['Mail.ReadWrite', 'Mail.Send', 'Calendars.ReadWrite', 'Files.ReadWrite.All', 'User.Read.All', 'OnlineMeetingRecording.Read.All', 'OnlineMeetingTranscript.Read.All'];
const graphMessage = t.obj({
  id: t.str(), conversationId: t.opt(t.str()), subject: t.opt(t.str()), bodyPreview: t.opt(t.str()), receivedDateTime: t.opt(t.str()), isRead: t.opt(t.bool()),
  from: t.opt(t.rec()), toRecipients: t.opt(t.arr(t.rec())), categories: t.opt(t.arr(t.str())), parentFolderId: t.opt(t.str()),
});
const graphEvent = t.obj({
  id: t.str(), subject: t.opt(t.str()), start: t.rec(), end: t.rec(), location: t.opt(t.rec()), onlineMeeting: t.opt(t.rec()),
  attendees: t.opt(t.arr(t.obj({ email, response: t.opt(t.str()), type: t.opt(t.str()) }))), organizer: t.opt(t.rec()), isCancelled: t.opt(t.bool()),
});
const driveItem = t.obj({ id: t.str(), name: t.str(), size: t.opt(t.int()), lastModifiedDateTime: t.opt(t.str()), folder: t.opt(t.bool()), webUrl: t.opt(t.str()), parentId: t.opt(t.str()) });
const eventWrite = {
  calendarId: t.opt(t.str()), subject: t.opt(t.str()), body: t.opt(t.str()), location: t.opt(t.str()), start: t.opt(t.rec()), end: t.opt(t.rec()),
  attendees: t.opt(t.arr(t.obj({ email, optional: t.opt(t.bool()) }))), teamsMeeting: t.opt(t.bool()),
};

type Gen = (name: string, summary: string, inn: Props, out: Props, o?: CapOpts) => ReturnType<typeof read>;
const gr: Gen = (name, summary, inn, out, o = {}) => read(name, summary, { in: { ...act, ...inn }, out, ...onConn, ...o });
const gw: Gen = (name, summary, inn, out, o = {}) => outward(name, summary, { in: { ...act, ...inn }, out, ...onConn, ...o });

const capabilities = [
  // ---- admin consent setup (Console > Integrations)
  read('ms.consent.status', 'State of the Microsoft 365 connection: app registered, consent given, access policy checked, mapped members', {
    in: {}, out: { configured: t.bool(), tenantId: t.opt(t.str()), consentGiven: t.bool(), policyConfirmed: t.bool(), lastVerifyAt: t.opt(t.ts()), autoConnect: t.bool(), mappedMembers: t.int(), excluded: t.arr(email) },
    perm: 'connectors.manage', tool: 'engineer',
  }),
  read('ms.consent.link', 'The admin consent link to open as a tenant admin, with the application permissions it grants', {
    in: { tenantId: t.opt(t.str()) }, out: { url: t.str(), permissions: t.arr(t.str()) }, perm: 'connectors.manage', tool: 'engineer',
  }),
  read('ms.consent.policy_snippet', 'PowerShell for the Exchange application access policy, limited to the mapped members, for a tenant admin to run', {
    in: {}, out: { language: t.lit('powershell'), snippet: t.str(), groupName: t.str() }, perm: 'connectors.manage', tool: 'engineer',
  }),
  write('ms.consent.setup', 'Store the app registration (Vault item Microsoft_App), map members by email and, with auto-connect on, create their Pending mail and calendar connections', {
    in: { vaultItem: id.handle, tenantId: t.str(), domain: t.opt(t.str()) }, out: { configured: t.bool(), mappedMembers: t.int(), connected: t.int() },
    perm: 'connectors.manage', risk: 'high', emits: ['microsoft.consent_configured'], idem: 'key', audit: 'always', tool: 'engineer', errors: ['provider.auth_failed', 'validation.precondition_failed'],
  }),
  write('ms.consent.verify', 'Call GET /organization and check consent and the access policy for a probe member', {
    in: { as: t.opt(email), policyConfirmed: t.opt(t.bool()) }, out: { ok: t.bool(), missingPermissions: t.arr(t.str()), detail: t.opt(t.str()) },
    perm: 'connectors.manage', emits: ['microsoft.consent_verified'], audit: 'always', tool: 'engineer', errors: ['provider.auth_failed'],
  }),
  read('ms.consent.members', 'Tenant users mapped to Space members by email, with exclusion and mailbox state', {
    in: { ...pageIn }, out: { members: t.arr(t.obj({ email, userId: t.opt(id.user), mapped: t.bool(), excluded: t.bool(), mailboxState: t.opt(t.str()) })), ...pageOut }, perm: 'connectors.manage', tool: 'engineer',
  }),
  write('ms.consent.set_excluded', 'Exclude a member from the connection, or include them again (excluded members never get a connection)', {
    in: { email, excluded: t.bool() }, out: { excluded: t.arr(email) }, perm: 'connectors.manage', audit: 'always', tool: 'engineer',
  }),
  write('ms.consent.disable', 'Turn the Microsoft connection off and stop every member sync', {
    in: {}, out: { disabled: t.bool() }, perm: 'connectors.manage', risk: 'high', emits: ['microsoft.consent_revoked'], audit: 'always', tool: 'engineer', gate: { act: 'delete', when: "actor.kind != 'person'" },
  }),
  read('ms.health', 'Health probe: GET /organization', { in: {}, out: healthOut }),
  write('ms.receive_notification', 'Record a verified Graph change notification (answers the validationToken handshake) after dedupe', {
    in: { notificationId: t.str(), subscriptionId: t.str(), resource: t.str(), changeType: t.enm('created', 'updated', 'deleted'), clientStateOk: t.bool(), tenantId: t.opt(t.str()) },
    out: { accepted: t.bool() }, emits: ['microsoft.notification_received'], idem: 'natural', offline: 'online',
  }),
  write('ms.subscriptions.renew', 'Renew every Graph subscription before it expires (lifetime is about 3 days); a Run does this on a schedule', {
    in: {}, out: { runId: id.run }, perm: 'connectors.manage', run: { kind: 'ms_subscription_renew', stoppable: false }, idem: 'natural',
  }),
  // ---- mail
  gr('ms.mail.list_folders', 'List mail folders of the member', {}, { folders: t.arr(t.obj({ id: t.str(), displayName: t.str(), unreadItemCount: t.opt(t.int()) })) }, { tool: 'inbox', deferred: true }),
  gr('ms.mail.list_messages', 'List or search messages', { folderId: t.opt(t.str()), search: t.opt(t.str()), top: t.opt(t.int({ minimum: 1, maximum: 1000 })), skipToken: t.opt(t.str()) },
    { messages: t.arr(graphMessage), nextSkipToken: t.opt(t.str()) }, { tool: 'inbox', deferred: true }),
  gr('ms.mail.get_message', 'Read one message', { messageId: t.str() }, { message: graphMessage, body: t.opt(t.str()) }, { tool: 'inbox', deferred: true }),
  gr('ms.mail.delta', 'Changes in a mail folder since a delta link (fallback when change notifications are missed)', { folderId: t.str(), deltaLink: t.opt(t.str()) },
    { changed: t.arr(graphMessage), removed: t.arr(t.str()), deltaLink: t.str() }),
  gr('ms.mail.get_attachment', 'Download an attachment into a blob', { messageId: t.str(), attachmentId: t.str() }, { blobId: id.blob, size: t.int() }),
  gw('ms.mail.update_message', 'Mark read, flag or categorise a message in the member mailbox', { messageId: t.str(), isRead: t.opt(t.bool()), categories: t.opt(t.arr(t.str())) }, { message: graphMessage },
    { gate: quiet("Changes flags in the member's own mailbox; nothing is sent to anyone"), tool: 'inbox', deferred: true }),
  gw('ms.mail.move_message', 'Move a message to another folder', { messageId: t.str(), folderId: t.str() }, { message: graphMessage }, { gate: quiet("Moves a message inside the member's own mailbox; nothing is sent to anyone"), tool: 'inbox', deferred: true }),
  gw('ms.mail.create_draft', 'Create a draft in the member mailbox', { to: t.arr(email), subject: t.str(), text: t.opt(t.str()), html: t.opt(t.str()) }, { draftId: t.str() },
    { gate: quiet('The draft stays in the member mailbox; nothing is sent'), tool: 'inbox', deferred: true }),
  gw('ms.mail.send_message', 'Send a message from the member mailbox', { to: t.arr(email), cc: t.opt(t.arr(email)), bcc: t.opt(t.arr(email)), subject: t.str(), text: t.opt(t.str()), html: t.opt(t.str()), conversationId: t.opt(t.str()), attachments: t.opt(t.arr(id.file)) },
    { sent: t.bool() }, { gate: 'send', errors: ['provider.rate_limited', 'provider.auth_failed'] }),
  gw('ms.mail.delete_message', 'Delete a message (moves it to Deleted Items)', { messageId: t.str() }, { deleted: t.bool() }, { gate: 'delete', tool: 'inbox', deferred: true }),
  gw('ms.mail.subscribe', 'Subscribe to change notifications for a mail folder', { folderId: t.str(), notificationUrl: t.str() }, { subscriptionId: t.str(), expiresAt: t.ts() }, { gate: quiet('Registers a change subscription for the Space; nothing is sent to anyone') }),
  gw('ms.mail.unsubscribe', 'Remove a mail change subscription', { subscriptionId: t.str() }, { removed: t.bool() }, { gate: quiet('Removes a change subscription; nothing is sent to anyone') }),
  // ---- calendar
  gr('ms.calendar.list_calendars', 'List the calendars of the member', {}, { calendars: t.arr(t.obj({ id: t.str(), name: t.str(), color: t.opt(t.str()), isDefault: t.opt(t.bool()), canEdit: t.opt(t.bool()) })) }, { tool: 'inbox', deferred: true }),
  gr('ms.calendar.list_events', 'List events in a range', { calendarId: t.opt(t.str()), start: t.str(), end: t.str(), skipToken: t.opt(t.str()) }, { events: t.arr(graphEvent), nextSkipToken: t.opt(t.str()) }, { tool: 'inbox', deferred: true }),
  gr('ms.calendar.get_event', 'Read one event', { eventId: t.str() }, { event: graphEvent }, { tool: 'inbox', deferred: true }),
  gr('ms.calendar.delta', 'Changes in a calendar view since a delta link', { calendarId: t.opt(t.str()), start: t.str(), end: t.str(), deltaLink: t.opt(t.str()) }, { changed: t.arr(graphEvent), removed: t.arr(t.str()), deltaLink: t.str() }),
  gw('ms.calendar.create_event', 'Create an event; Exchange invites the attendees', eventWrite, { event: graphEvent }, { gate: 'send', tool: 'inbox', deferred: true }),
  gw('ms.calendar.update_event', 'Change an event; Exchange updates the attendees', { ...eventWrite, eventId: t.str() }, { event: graphEvent }, { gate: 'send', tool: 'inbox', deferred: true }),
  gw('ms.calendar.delete_event', 'Delete an event; Exchange tells the attendees', { eventId: t.str() }, { deleted: t.bool() }, { gate: 'send', tool: 'inbox', deferred: true }),
  gw('ms.calendar.respond', 'Accept, decline or answer maybe to an invitation', { eventId: t.str(), response: t.enm('accept', 'decline', 'tentativelyAccept'), comment: t.opt(t.str()) }, { sent: t.bool() }, { gate: 'send', tool: 'inbox', deferred: true }),
  gr('ms.calendar.get_schedule', 'Free and busy blocks for people over a range', { emails: t.arr(email, { minItems: 1 }), start: t.str(), end: t.str() }, { busy: t.arr(t.obj({ email, start: t.str(), end: t.str() })) }, { tool: 'inbox', deferred: true }),
  gr('ms.calendar.find_meeting_times', 'Suggested meeting times for a set of attendees', { emails: t.arr(email, { minItems: 1 }), durationMinutes: t.int({ minimum: 5 }), start: t.str(), end: t.str() },
    { slots: t.arr(t.obj({ start: t.str(), end: t.str(), confidence: t.opt(t.num()) })) }, { tool: 'inbox', deferred: true }),
  gw('ms.calendar.subscribe', 'Subscribe to change notifications for a calendar', { calendarId: t.opt(t.str()), notificationUrl: t.str() }, { subscriptionId: t.str(), expiresAt: t.ts() }, { gate: quiet('Registers a change subscription for the Space; nothing is sent to anyone') }),
  gw('ms.calendar.unsubscribe', 'Remove a calendar change subscription', { subscriptionId: t.str() }, { removed: t.bool() }, { gate: quiet('Removes a change subscription; nothing is sent to anyone') }),
  // ---- drive (OneDrive and SharePoint)
  gr('ms.drive.list_items', 'List items in a OneDrive or SharePoint folder', { driveId: t.opt(t.str()), folderId: t.opt(t.str()), skipToken: t.opt(t.str()) }, { items: t.arr(driveItem), nextSkipToken: t.opt(t.str()) }, { tool: 'files', deferred: true }),
  gr('ms.drive.get_item', 'Read item metadata', { driveId: t.opt(t.str()), itemId: t.str() }, { item: driveItem }, { tool: 'files', deferred: true }),
  gr('ms.drive.download_item', 'Download an item into a blob', { driveId: t.opt(t.str()), itemId: t.str() }, { blobId: id.blob, size: t.int() }, { tool: 'files', deferred: true }),
  gr('ms.drive.delta', 'Item changes since a delta link (mount sync and mount lag)', { driveId: t.opt(t.str()), deltaLink: t.opt(t.str()) }, { changed: t.arr(driveItem), removed: t.arr(t.str()), deltaLink: t.str() }),
  gw('ms.drive.upload_item', 'Upload a Space file into OneDrive or SharePoint', { driveId: t.opt(t.str()), folderId: t.opt(t.str()), name: t.str(), fileId: id.file }, { item: driveItem }, { gate: 'post', tool: 'files', deferred: true }),
  gw('ms.drive.create_folder', 'Create a folder', { driveId: t.opt(t.str()), parentId: t.opt(t.str()), name: t.str() }, { item: driveItem }, { gate: 'post', tool: 'files', deferred: true }),
  gw('ms.drive.share_item', 'Create a sharing link or invite people; Microsoft emails them', { driveId: t.opt(t.str()), itemId: t.str(), emails: t.opt(t.arr(email)), role: t.enm('read', 'write') }, { shared: t.bool(), link: t.opt(t.str()) }, { gate: 'send', tool: 'files', deferred: true }),
  gw('ms.drive.delete_item', 'Delete an item', { driveId: t.opt(t.str()), itemId: t.str() }, { deleted: t.bool() }, { gate: 'delete', tool: 'files', deferred: true }),
  // ---- Teams recordings and transcripts (needs OnlineMeetingRecording.Read.All and OnlineMeetingTranscript.Read.All)
  gr('ms.teams.recordings.list_recordings', 'Recordings of an online meeting', { onlineMeetingId: t.str() }, { recordings: t.arr(t.obj({ id: t.str(), createdAt: t.opt(t.str()), contentUrl: t.opt(t.str()) })) }, { tool: 'inbox', deferred: true }),
  gr('ms.teams.recordings.get_recording', 'Download a Teams recording into a blob', { onlineMeetingId: t.str(), recordingId: t.str() }, { blobId: id.blob, size: t.int() }, { tool: 'inbox', deferred: true }),
  gr('ms.teams.recordings.list_transcripts', 'Transcripts of an online meeting', { onlineMeetingId: t.str() }, { transcripts: t.arr(t.obj({ id: t.str(), createdAt: t.opt(t.str()) })) }, { tool: 'inbox', deferred: true }),
  gr('ms.teams.recordings.get_transcript', 'Transcript text (VTT) of an online meeting', { onlineMeetingId: t.str(), transcriptId: t.str() }, { vtt: t.str() }, { tool: 'inbox', deferred: true }),
  gw('ms.teams.recordings.subscribe', 'Subscribe to recording and transcript ready notices', { resource: t.str(), notificationUrl: t.str() }, { subscriptionId: t.str(), expiresAt: t.ts() }, { gate: quiet('Registers a change subscription for the Space; nothing is sent to anyone') }),
];

// Common operations whose handlers already exist. Word, Excel, and admin consent stay off the catalogue.
const accountErrors = ['validation.bad_input', 'internal.unexpected', 'provider.auth_failed', 'provider.unavailable', 'permission.needs_approval'];
const steps = [
  step('ms.mail.list_messages', 'Microsoft · List Outlook messages', 'data', 'capability', {
    cap: 'ms.mail.list_messages', effects: 'read', errors: accountErrors,
    in: { ...act, folderId: t.opt(t.str()), search: t.opt(t.str()), top: t.opt(t.int({ minimum: 1, maximum: 1000 })) },
    out: { messages: t.arr(graphMessage) },
  }),
  step('ms.mail.send_message', 'Microsoft · Send an Outlook message', 'send', 'capability', {
    cap: 'ms.mail.send_message', effects: 'outward', gateAct: 'send', idempotency: 'key', errors: accountErrors,
    in: { ...act, to: t.arr(email), subject: t.str(), text: t.opt(t.str()), html: t.opt(t.str()) },
    out: { sent: t.bool() },
  }),
  step('ms.calendar.list_events', 'Microsoft · List calendar events', 'data', 'capability', {
    cap: 'ms.calendar.list_events', effects: 'read', errors: accountErrors,
    in: { ...act, calendarId: t.opt(t.str()), start: t.str(), end: t.str() },
    out: { events: t.arr(graphEvent) },
  }),
  step('ms.calendar.create_event', 'Microsoft · Create a calendar event', 'send', 'capability', {
    cap: 'ms.calendar.create_event', effects: 'outward', gateAct: 'send', idempotency: 'key', errors: accountErrors,
    in: { ...act, ...eventWrite },
    out: { event: graphEvent },
  }),
  step('ms.drive.list_items', 'Microsoft · List OneDrive or SharePoint items', 'data', 'capability', {
    cap: 'ms.drive.list_items', effects: 'read', errors: accountErrors,
    in: { ...act, driveId: t.opt(t.str()), folderId: t.opt(t.str()) },
    out: { items: t.arr(driveItem) },
  }),
  step('ms.drive.create_folder', 'Microsoft · Create a OneDrive or SharePoint folder', 'data', 'capability', {
    cap: 'ms.drive.create_folder', effects: 'outward', gateAct: 'post', idempotency: 'key', errors: accountErrors,
    in: { ...act, driveId: t.opt(t.str()), parentId: t.opt(t.str()), name: t.str() },
    out: { item: driveItem },
  }),
];

export default defineManifest({
  id: 'microsoft',
  title: 'Microsoft 365',
  kind: 'connector',
  owner: 'L5',
  events: [
    ev('microsoft.consent_configured', 'The Microsoft app registration was stored and members mapped', { p: { connector: t.lit('microsoft'), tenantId: t.str(), mappedMembers: t.int(), autoConnect: t.bool() }, subject: ['connector', '/connector'] }),
    ev('microsoft.consent_verified', 'A consent and access policy check ran', { p: { connector: t.lit('microsoft'), ok: t.bool(), missingPermissions: t.arr(t.str()) }, subject: ['connector', '/connector'] }),
    ev('microsoft.consent_revoked', 'The Microsoft connection was turned off', { p: { connector: t.lit('microsoft'), by: t.str() }, subject: ['connector', '/connector'] }),
    ev('microsoft.notification_received', 'A verified Graph change notification arrived', {
      p: { connector: t.lit('microsoft'), notificationId: t.str(), subscriptionId: t.str(), resource: t.str(), changeType: t.enm('created', 'updated', 'deleted'), tenantId: t.opt(t.str()) }, subject: ['connector', '/connector'],
    }),
  ],
  capabilities,
  steps,
  connectors: [
    conn('microsoft', 'Microsoft 365', {
      mode: 'oauth_app', scope: 'space',
      auth: { type: 'client_credentials', tokenUrl: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token', scopes: ['https://graph.microsoft.com/.default'] },
      domains: ['graph.microsoft.com', 'login.microsoftonline.com'],
      secrets: [{ name: 'Microsoft_App', description: `App registration client id, client secret and tenant id. Application permissions: ${PERMISSIONS.join(', ')}` }],
      sources: [{ key: 'graph', path: '/hooks/graph', verify: 'signature', event: 'microsoft.notification_received', dedupe: '/notificationId' }],
      actions: [...capabilities.map((c) => c.name).filter((n) => n.startsWith('ms.')), 'mail.connect', 'mail.sync_now', 'mail.send_as'],
      rate: { rps: 10, burst: 20 }, health: 'microsoft.graph',
    }),
  ],
  health: [
    health('microsoft.graph', 'Microsoft 365 connection', 'ms.health', 'Check the admin consent and the Exchange application access policy, then press Verify.', { pauses: ['sync'] }),
  ],
  screens: [
    screen('microsoft.setup', 'console', 'ui:MicrosoftConsentWizard', {
      q: { status: ['ms.consent.status', {}, true], link: ['ms.consent.link', { tenantId: '/state/tenantId' }, false], snippet: ['ms.consent.policy_snippet', {}, false], members: ['ms.consent.members', {}, true] },
      a: {
        setup: ['ms.consent.setup', { vaultItem: '/state/vaultItem', tenantId: '/state/tenantId', domain: '/state/domain' }], verify: ['ms.consent.verify', { as: '/state/as', policyConfirmed: '/state/policyConfirmed' }],
        exclude: ['ms.consent.set_excluded', { email: '/state/email', excluded: '/state/excluded' }], disable: ['ms.consent.disable', {}, 'Turn off Microsoft 365 and stop every member sync?'],
      },
      empty: 'Microsoft 365 is not connected', primary: 'Set up Microsoft 365', needs: ['connectors.manage'],
    }),
  ],
  settings: [
    setting('microsoft.auto_connect', 'space', 'integrations', 'Connect members mail and calendar when consent is given', t.bool(), true),
    setting('microsoft.excluded_members', 'space', 'integrations', 'Members excluded from the Microsoft connection', t.arr(email), []),
  ],
});
