// google (lane L5): Google Workspace connector. Service account with domain-wide delegation (DWD) acting as each mapped
// member; Gmail, Calendar, Drive, Sheets, Docs and Meet capabilities. ARCHITECTURE 8 table and 8.1, spec 2.18, 2.10.
// DECISION: every Google call carries `connectionId` (the Space connection that holds the Google_DWD key) and an optional
// `as` member address. `as` defaults to the caller's mapped address; another address needs an admin. Each call is logged
// per person (audit class `sample` for bulk reads).
// DECISION: provider writes that change only the member's own Google data and notify nobody use the explicit gate
// { act: 'none', reason }. Anything that sends to other people uses the Gate act 'send'; writes to Drive and Sheets use 'post'.
// DECISION: DWD admin actions are in the `engineer` toolset (Console assistant), provider reads are deferred tools.
// DECISION: the Space policy `google.auto_connect` (default on) and `microsoft.auto_connect` are two rows of one policy;
// the effective value is the row for the provider being set up.
import { conn, defineManifest, ev, health, outward, read, screen, setting, t, write } from '../packages/contracts/src/index.ts';
import type { CapOpts, Props } from '../packages/contracts/src/index.ts';
import { email, id, pageIn, pageOut } from './_common.ts';

const act: Props = { connectionId: id.connection, as: t.opt(email) };
const onConn = { on: ['connection', '/connectionId'] } as const;
const quiet = (what: string) => ({ act: 'none', reason: what });
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/meetings.space.readonly',
];
const healthOut = { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()) };
const gmailMessage = t.obj({ id: t.str(), threadId: t.str(), labelIds: t.arr(t.str()), snippet: t.opt(t.str()), historyId: t.opt(t.str()), internalDate: t.opt(t.ts()), payload: t.opt(t.rec()) });
const driveFile = t.obj({ id: t.str(), name: t.str(), mimeType: t.str(), parents: t.opt(t.arr(t.str())), modifiedTime: t.opt(t.str()), size: t.opt(t.int()), webViewLink: t.opt(t.str()), driveId: t.opt(t.str()) });
const gcalEvent = t.obj({
  id: t.str(), status: t.opt(t.str()), summary: t.opt(t.str()), start: t.rec(), end: t.rec(), location: t.opt(t.str()), hangoutLink: t.opt(t.str()),
  attendees: t.opt(t.arr(t.obj({ email, responseStatus: t.opt(t.str()), optional: t.opt(t.bool()) }))), organizer: t.opt(t.rec()), updated: t.opt(t.str()),
});
const eventWrite = {
  calendarId: t.str({ examples: ['primary'] }), summary: t.opt(t.str()), description: t.opt(t.str()), location: t.opt(t.str()), start: t.opt(t.rec()), end: t.opt(t.rec()),
  attendees: t.opt(t.arr(t.obj({ email, optional: t.opt(t.bool()) }))), conference: t.opt(t.bool()), sendUpdates: t.opt(t.enm('all', 'externalOnly', 'none')),
};

type Gen = (name: string, summary: string, inn: Props, out: Props, o?: CapOpts) => ReturnType<typeof read>;
const gr: Gen = (name, summary, inn, out, o = {}) => read(name, summary, { in: { ...act, ...inn }, out, ...onConn, ...o });
const gw: Gen = (name, summary, inn, out, o = {}) => outward(name, summary, { in: { ...act, ...inn }, out, ...onConn, ...o });

const capabilities = [
  // ---- delegation setup (Console > Integrations)
  read('google.dwd.status', 'State of domain-wide delegation: key stored, scopes, last probe, mapped members', {
    in: {}, out: {
      configured: t.bool(), adminEmail: t.opt(email), domain: t.opt(t.str()), lastProbeAt: t.opt(t.ts()), lastProbeOk: t.opt(t.bool()), autoConnect: t.bool(), mappedMembers: t.int(), excluded: t.arr(email),
    },
    perm: 'connectors.manage', tool: 'engineer',
  }),
  read('google.dwd.scopes', 'The scope list and client id to paste into the Google Admin console', {
    in: {}, out: { scopes: t.arr(t.str()), clientId: t.opt(t.str()), adminConsoleUrl: t.str() }, perm: 'connectors.manage', tool: 'engineer',
  }),
  write('google.dwd.setup', 'Store the service account JSON (Vault item Google_DWD), map members by email and, with auto-connect on, create their Pending mail and calendar connections', {
    in: { vaultItem: id.handle, adminEmail: email, domain: t.opt(t.str()) }, out: { configured: t.bool(), scopes: t.arr(t.str()), mappedMembers: t.int(), connected: t.int() },
    perm: 'connectors.manage', risk: 'high', emits: ['google.dwd_configured'], idem: 'key', audit: 'always', tool: 'engineer', errors: ['provider.auth_failed', 'validation.precondition_failed'],
  }),
  write('google.dwd.probe', 'Mint a token for a probe user and call users.getProfile to prove the delegation and scopes', {
    in: { as: t.opt(email) }, out: { ok: t.bool(), email: t.opt(email), scopesMissing: t.arr(t.str()), detail: t.opt(t.str()) },
    perm: 'connectors.manage', emits: ['google.dwd_probed'], audit: 'always', tool: 'engineer', errors: ['provider.auth_failed'],
  }),
  read('google.dwd.members', 'Workspace users mapped to Space members by email, with exclusion and mailbox state', {
    in: { ...pageIn }, out: { members: t.arr(t.obj({ email, userId: t.opt(id.user), mapped: t.bool(), excluded: t.bool(), mailboxState: t.opt(t.str()) })), ...pageOut }, perm: 'connectors.manage', tool: 'engineer',
  }),
  write('google.dwd.set_excluded', 'Exclude a member from delegation, or include them again (excluded members never get a connection)', {
    in: { email, excluded: t.bool() }, out: { excluded: t.arr(email) }, perm: 'connectors.manage', audit: 'always', tool: 'engineer',
  }),
  write('google.dwd.disable', 'Turn delegation off and stop every member sync', {
    in: {}, out: { disabled: t.bool() }, perm: 'connectors.manage', risk: 'high', emits: ['google.dwd_revoked'], audit: 'always', tool: 'engineer',
    gate: { act: 'delete', when: "actor.kind != 'person'" },
  }),
  read('google.health', 'Health probe: mint a token for the probe user and call users.getProfile', { in: { as: t.opt(email) }, out: healthOut }),
  write('google.receive_push', 'Record a verified Google push (Gmail Pub/Sub, Calendar channel, Drive changes, Meet events) after dedupe', {
    in: {
      kind: t.enm('gmail', 'calendar', 'drive', 'meet'), messageId: t.str(), mailbox: t.opt(email), historyId: t.opt(t.str()), channelId: t.opt(t.str()),
      resourceState: t.opt(t.str()), resourceId: t.opt(t.str()),
    },
    out: { accepted: t.bool() }, emits: ['google.push_received'], idem: 'natural', offline: 'online',
  }),
  // ---- Gmail
  gr('google.gmail.get_profile', 'Gmail profile of the member (address, history id)', {}, { emailAddress: email, historyId: t.str(), messagesTotal: t.opt(t.int()) }),
  gr('google.gmail.list_labels', 'List Gmail labels', {}, { labels: t.arr(t.obj({ id: t.str(), name: t.str(), type: t.opt(t.str()) })) }, { tool: 'inbox', deferred: true }),
  gr('google.gmail.list_messages', 'Search or list Gmail messages', { q: t.opt(t.str()), labelIds: t.opt(t.arr(t.str())), maxResults: t.opt(t.int({ minimum: 1, maximum: 500 })), pageToken: t.opt(t.str()) },
    { messages: t.arr(t.obj({ id: t.str(), threadId: t.str() })), nextPageToken: t.opt(t.str()), resultSizeEstimate: t.opt(t.int()) }, { tool: 'inbox', deferred: true }),
  gr('google.gmail.get_message', 'Read one Gmail message', { messageId: t.str(), format: t.opt(t.enm('metadata', 'full', 'raw')) }, { message: gmailMessage }, { tool: 'inbox', deferred: true }),
  gr('google.gmail.get_thread', 'Read a Gmail thread', { threadId: t.str() }, { threadId: t.str(), messages: t.arr(gmailMessage) }, { tool: 'inbox', deferred: true }),
  gr('google.gmail.list_history', 'Changes since a history id (cursor polling: 2 min active, 15 idle, 1 h dormant)', { startHistoryId: t.str(), pageToken: t.opt(t.str()) },
    { history: t.arr(t.obj({ id: t.str(), added: t.arr(t.str()), deleted: t.arr(t.str()), labelsChanged: t.arr(t.str()) })), historyId: t.str(), nextPageToken: t.opt(t.str()), expired: t.bool() }),
  gr('google.gmail.get_attachment', 'Download an attachment into a blob', { messageId: t.str(), attachmentId: t.str() }, { blobId: id.blob, size: t.int() }),
  gw('google.gmail.modify_labels', 'Add or remove labels on a message in the member mailbox', { messageId: t.str(), add: t.opt(t.arr(t.str())), remove: t.opt(t.arr(t.str())) }, { message: gmailMessage },
    { gate: quiet("Changes labels in the member's own Gmail; nothing is sent to anyone"), tool: 'inbox', deferred: true }),
  gw('google.gmail.create_draft', 'Create a draft in the member mailbox', { to: t.arr(email), subject: t.str(), text: t.opt(t.str()), html: t.opt(t.str()), threadId: t.opt(t.str()) }, { draftId: t.str() },
    { gate: quiet('The draft stays in the member Gmail; nothing is sent'), tool: 'inbox', deferred: true }),
  gw('google.gmail.send_message', 'Send a message from the member mailbox', { to: t.arr(email), cc: t.opt(t.arr(email)), bcc: t.opt(t.arr(email)), subject: t.str(), text: t.opt(t.str()), html: t.opt(t.str()), threadId: t.opt(t.str()), attachments: t.opt(t.arr(id.file)) },
    { id: t.str(), threadId: t.str() }, { gate: 'send', errors: ['provider.rate_limited', 'provider.auth_failed'] }),
  gw('google.gmail.trash_message', 'Move a Gmail message to Trash', { messageId: t.str() }, { trashed: t.bool() }, { gate: 'delete', tool: 'inbox', deferred: true }),
  gw('google.gmail.watch', 'Start Gmail push notices through Pub/Sub for the member mailbox', { topicName: t.str(), labelIds: t.opt(t.arr(t.str())) }, { historyId: t.str(), expiration: t.ts() },
    { gate: quiet('Registers a push channel for the Space; nothing is sent to anyone') }),
  gw('google.gmail.stop_watch', 'Stop Gmail push notices for the member mailbox', {}, { stopped: t.bool() }, { gate: quiet('Removes a push channel; nothing is sent to anyone') }),
  // ---- Calendar
  gr('google.calendar.list_calendars', 'List the calendars of the member', {}, { calendars: t.arr(t.obj({ id: t.str(), summary: t.str(), primary: t.opt(t.bool()), backgroundColor: t.opt(t.str()), accessRole: t.opt(t.str()) })) }, { tool: 'inbox', deferred: true }),
  gr('google.calendar.list_events', 'List events (incremental with a sync token)', { calendarId: t.str({ examples: ['primary'] }), timeMin: t.opt(t.str()), timeMax: t.opt(t.str()), q: t.opt(t.str()), syncToken: t.opt(t.str()), pageToken: t.opt(t.str()) },
    { events: t.arr(gcalEvent), nextPageToken: t.opt(t.str()), nextSyncToken: t.opt(t.str()) }, { tool: 'inbox', deferred: true }),
  gr('google.calendar.get_event', 'Read one event', { calendarId: t.str(), eventId: t.str() }, { event: gcalEvent }, { tool: 'inbox', deferred: true }),
  gw('google.calendar.create_event', 'Create an event; Google invites the attendees', eventWrite, { event: gcalEvent }, { gate: 'send', tool: 'inbox', deferred: true }),
  gw('google.calendar.update_event', 'Change an event; Google updates the attendees', { ...eventWrite, eventId: t.str() }, { event: gcalEvent }, { gate: 'send', tool: 'inbox', deferred: true }),
  gw('google.calendar.delete_event', 'Delete an event; Google tells the attendees', { calendarId: t.str(), eventId: t.str(), sendUpdates: t.opt(t.enm('all', 'externalOnly', 'none')) }, { deleted: t.bool() }, { gate: 'send', tool: 'inbox', deferred: true }),
  gw('google.calendar.respond', 'Accept, decline or answer maybe to an invitation', { calendarId: t.str(), eventId: t.str(), response: t.enm('accepted', 'declined', 'tentative') }, { event: gcalEvent }, { gate: 'send', tool: 'inbox', deferred: true }),
  gr('google.calendar.free_busy', 'Busy blocks for people over a range', { emails: t.arr(email, { minItems: 1 }), timeMin: t.str(), timeMax: t.str() },
    { busy: t.arr(t.obj({ email, start: t.str(), end: t.str() })) }, { tool: 'inbox', deferred: true }),
  gw('google.calendar.watch', 'Open an events.watch channel for a calendar', { calendarId: t.str(), channelId: t.str(), address: t.str() }, { resourceId: t.str(), expiration: t.ts() }, { gate: quiet('Registers a push channel for the Space; nothing is sent to anyone') }),
  gw('google.calendar.stop_watch', 'Close an events.watch channel', { channelId: t.str(), resourceId: t.str() }, { stopped: t.bool() }, { gate: quiet('Removes a push channel; nothing is sent to anyone') }),
  // ---- Drive
  gr('google.drive.list_files', 'List or search Drive files and folders (My Drive and Shared Drives)', { q: t.opt(t.str()), driveId: t.opt(t.str()), parentId: t.opt(t.str()), pageToken: t.opt(t.str()), pageSize: t.opt(t.int({ minimum: 1, maximum: 1000 })) },
    { files: t.arr(driveFile), nextPageToken: t.opt(t.str()) }, { tool: 'files', deferred: true }),
  gr('google.drive.get_file', 'Read Drive file metadata', { fileId: t.str() }, { file: driveFile }, { tool: 'files', deferred: true }),
  gr('google.drive.download_file', 'Download a Drive file into a blob', { fileId: t.str() }, { blobId: id.blob, size: t.int(), mimeType: t.str() }, { tool: 'files', deferred: true }),
  gr('google.drive.export_file', 'Export a Google document, sheet or slide as PDF, DOCX, XLSX or text', { fileId: t.str(), mimeType: t.str({ examples: ['application/pdf'] }) }, { blobId: id.blob, size: t.int() }, { tool: 'files', deferred: true }),
  gr('google.drive.get_permissions', 'Who a Drive file is shared with', { fileId: t.str() }, { permissions: t.arr(t.obj({ id: t.str(), role: t.str(), type: t.str(), emailAddress: t.opt(email) })) }, { tool: 'files', deferred: true }),
  gw('google.drive.upload_file', 'Upload a Space file into Drive', { name: t.str(), parentId: t.opt(t.str()), fileId: id.file }, { file: driveFile }, { gate: 'post', tool: 'files', deferred: true }),
  gw('google.drive.create_folder', 'Create a Drive folder', { name: t.str(), parentId: t.opt(t.str()) }, { file: driveFile }, { gate: 'post', tool: 'files', deferred: true }),
  gw('google.drive.copy_file', 'Copy a Drive file', { fileId: t.str(), name: t.opt(t.str()), parentId: t.opt(t.str()) }, { file: driveFile }, { gate: 'post', tool: 'files', deferred: true }),
  gw('google.drive.share_file', 'Share a Drive file with people; Google emails them', { fileId: t.str(), emails: t.arr(email, { minItems: 1 }), role: t.enm('reader', 'commenter', 'writer'), notify: t.opt(t.bool()) }, { shared: t.bool() }, { gate: 'send', tool: 'files', deferred: true }),
  gw('google.drive.trash_file', 'Move a Drive file to Trash', { fileId: t.str() }, { trashed: t.bool() }, { gate: 'delete', tool: 'files', deferred: true }),
  gr('google.drive.changes_start_token', 'The Drive changes start page token, so a mount syncs incrementally from now instead of rescanning', { driveId: t.opt(t.str()) }, { startPageToken: t.str() }),
  gr('google.drive.list_changes', 'Drive changes since a page token (mount sync and mount lag)', { pageToken: t.str(), driveId: t.opt(t.str()) }, { changes: t.arr(t.obj({ fileId: t.str(), removed: t.bool(), file: t.opt(driveFile) })), newStartPageToken: t.opt(t.str()), nextPageToken: t.opt(t.str()) }),
  gw('google.drive.watch_changes', 'Open a Drive changes.watch channel', { pageToken: t.str(), channelId: t.str(), address: t.str(), driveId: t.opt(t.str()) }, { resourceId: t.str(), expiration: t.ts() }, { gate: quiet('Registers a push channel for the Space; nothing is sent to anyone') }),
  gw('google.drive.stop_watch', 'Close a Drive watch channel', { channelId: t.str(), resourceId: t.str() }, { stopped: t.bool() }, { gate: quiet('Removes a push channel; nothing is sent to anyone') }),
  // ---- Sheets
  gr('google.sheets.get_spreadsheet', 'Spreadsheet metadata: sheets and ranges', { spreadsheetId: t.str() }, { title: t.str(), sheets: t.arr(t.obj({ sheetId: t.int(), title: t.str(), rows: t.opt(t.int()), columns: t.opt(t.int()) })) }, { tool: 'records', deferred: true }),
  gr('google.sheets.get_values', 'Read a range of cells', { spreadsheetId: t.str(), range: t.str({ examples: ['Sheet1!A1:D50'] }) }, { values: t.arr(t.arr(t.str())) }, { tool: 'records', deferred: true }),
  gw('google.sheets.update_values', 'Write a range of cells', { spreadsheetId: t.str(), range: t.str(), values: t.arr(t.arr(t.str())), valueInputOption: t.opt(t.enm('RAW', 'USER_ENTERED')) }, { updatedCells: t.int() }, { gate: 'post', tool: 'records', deferred: true }),
  gw('google.sheets.append_values', 'Append rows to a sheet', { spreadsheetId: t.str(), range: t.str(), values: t.arr(t.arr(t.str())) }, { updatedRows: t.int() }, { gate: 'post', tool: 'records', deferred: true }),
  gw('google.sheets.create_spreadsheet', 'Create a spreadsheet', { title: t.str(), parentId: t.opt(t.str()) }, { spreadsheetId: t.str(), url: t.str() }, { gate: 'post', tool: 'records', deferred: true }),
  gw('google.sheets.batch_update', 'Apply structural changes to a spreadsheet (add sheet, format, resize)', { spreadsheetId: t.str(), requests: t.arr(t.rec()) }, { applied: t.int() }, { gate: 'post', tool: 'records', deferred: true }),
  // ---- Docs
  gr('google.docs.get_document', 'Read a Google Doc as structured content', { documentId: t.str() }, { title: t.str(), body: t.rec() }, { tool: 'files', deferred: true }),
  gw('google.docs.create_document', 'Create a Google Doc', { title: t.str(), parentId: t.opt(t.str()) }, { documentId: t.str(), url: t.str() }, { gate: 'post', tool: 'files', deferred: true }),
  gw('google.docs.batch_update', 'Edit a Google Doc with a list of requests', { documentId: t.str(), requests: t.arr(t.rec()) }, { applied: t.int() }, { gate: 'post', tool: 'files', deferred: true }),
  // ---- Meet (conferenceRecords through the Google connector)
  gr('google.meet.list_conference_records', 'List Meet conference records in a time range', { from: t.opt(t.str()), to: t.opt(t.str()), pageToken: t.opt(t.str()) },
    { records: t.arr(t.obj({ name: t.str(), startTime: t.str(), endTime: t.opt(t.str()), space: t.opt(t.str()) })), nextPageToken: t.opt(t.str()) }, { tool: 'inbox', deferred: true }),
  gr('google.meet.list_recordings', 'Recordings of a conference record (they also land in the organizer Drive)', { conferenceRecord: t.str() },
    { recordings: t.arr(t.obj({ name: t.str(), state: t.str(), driveFileId: t.opt(t.str()) })) }, { tool: 'inbox', deferred: true }),
  gr('google.meet.list_transcripts', 'Transcripts of a conference record', { conferenceRecord: t.str() },
    { transcripts: t.arr(t.obj({ name: t.str(), state: t.str(), docsDocumentId: t.opt(t.str()) })) }, { tool: 'inbox', deferred: true }),
  gr('google.meet.get_transcript_entries', 'Transcript entries (speaker, text, time)', { transcript: t.str(), pageToken: t.opt(t.str()) },
    { entries: t.arr(t.obj({ participant: t.opt(t.str()), text: t.str(), startTime: t.opt(t.str()) })), nextPageToken: t.opt(t.str()) }, { tool: 'inbox', deferred: true }),
  gw('google.meet.subscribe', 'Subscribe to Workspace Events for recording and transcript ready notices', { target: t.str(), eventTypes: t.arr(t.str()) }, { subscription: t.str(), expiration: t.opt(t.ts()) },
    { gate: quiet('Registers an events subscription for the Space; nothing is sent to anyone') }),
];

export default defineManifest({
  id: 'google',
  title: 'Google Workspace',
  kind: 'connector',
  owner: 'L5',
  events: [
    ev('google.dwd_configured', 'Domain-wide delegation was set up', { p: { connector: t.lit('google'), adminEmail: email, mappedMembers: t.int(), autoConnect: t.bool() }, subject: ['connector', '/connector'], vis: 'space' }),
    ev('google.dwd_probed', 'A delegation probe ran', { p: { connector: t.lit('google'), ok: t.bool(), email: t.opt(email), scopesMissing: t.arr(t.str()) }, subject: ['connector', '/connector'] }),
    ev('google.dwd_revoked', 'Delegation was turned off', { p: { connector: t.lit('google'), by: t.str() }, subject: ['connector', '/connector'] }),
    ev('google.push_received', 'A verified Google push notice arrived (Gmail, Calendar, Drive or Meet)', {
      p: { connector: t.lit('google'), kind: t.enm('gmail', 'calendar', 'drive', 'meet'), messageId: t.str(), mailbox: t.opt(email), historyId: t.opt(t.str()), channelId: t.opt(t.str()), resourceState: t.opt(t.str()), resourceId: t.opt(t.str()) },
      subject: ['connector', '/connector'], vis: 'space',
    }),
  ],
  capabilities,
  connectors: [
    conn('google', 'Google Workspace', {
      mode: 'dwd', scope: 'space', auth: { type: 'service_account_dwd', scopes: SCOPES },
      domains: ['*.googleapis.com', 'oauth2.googleapis.com', 'meet.googleapis.com'],
      secrets: [{ name: 'Google_DWD', description: 'Service account JSON key used for domain-wide delegation' }],
      sources: [{ key: 'google', path: '/hooks/google', verify: 'signature', event: 'google.push_received', dedupe: '/messageId' }],
      actions: [...capabilities.map((c) => c.name).filter((n) => n.startsWith('google.')), 'mail.connect', 'mail.sync_now', 'mail.send_as'],
      rate: { rps: 10, burst: 20 }, health: 'google.dwd',
    }),
  ],
  health: [
    health('google.dwd', 'Google Workspace delegation', 'google.health', 'Check the Google_DWD key in the Vault and the scopes in the Google Admin console, then press Probe.', { pauses: ['sync'] }),
  ],
  screens: [
    screen('google.setup', 'console', 'ui:GoogleDwdWizard', {
      q: { status: ['google.dwd.status', {}, true], scopes: ['google.dwd.scopes', {}, false], members: ['google.dwd.members', {}, true] },
      a: {
        setup: ['google.dwd.setup', { vaultItem: '/state/vaultItem', adminEmail: '/state/adminEmail', domain: '/state/domain' }], probe: ['google.dwd.probe', { as: '/state/as' }],
        exclude: ['google.dwd.set_excluded', { email: '/state/email', excluded: '/state/excluded' }], disable: ['google.dwd.disable', {}, 'Turn off Google delegation and stop every member sync?'],
      },
      empty: 'Google Workspace is not connected', primary: 'Set up delegation', needs: ['connectors.manage'],
    }),
  ],
  settings: [
    setting('google.auto_connect', 'space', 'integrations', 'Connect members mail and calendar when delegation is set', t.bool(), true),
    setting('google.excluded_members', 'space', 'integrations', 'Members excluded from Google delegation', t.arr(email), []),
  ],
});
