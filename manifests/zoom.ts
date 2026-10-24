// zoom (lane L5): Zoom connector. Server-to-Server OAuth app; creates and lists meetings, fetches recordings and
// transcripts, and receives meeting.started, recording.completed and recording.transcript_completed. Zoom is the first
// meeting source. ARCHITECTURE 8 table and 8.3, spec 2.10, 2.18.
// DECISION: creating a meeting in the Space Zoom account changes only that account and invites nobody (the calendar event
// sends invitations), so it uses { act: 'none', reason } rather than the Gate act 'send'.
// DECISION: the endpoint.url_validation challenge is answered by zoom.receive_webhook, which is why that capability returns a body.
import { conn, defineManifest, ev, health, outward, read, t, write } from '../packages/contracts/src/index.ts';
import { email, id, pageIn } from './_common.ts';

const healthOut = { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()) };
const quiet = (what: string) => ({ act: 'none', reason: what });
const zoomMeeting = t.obj({
  id: t.str({ examples: ['81234567890'] }), uuid: t.opt(t.str()), topic: t.str(), startTime: t.opt(t.ts()), durationMinutes: t.opt(t.int()), joinUrl: t.str(), password: t.opt(t.str()),
  hostEmail: t.opt(email), timezone: t.opt(t.str()),
});
const recordingFile = t.obj({ id: t.str(), fileType: t.str(), recordingType: t.opt(t.str()), fileSize: t.opt(t.int()), downloadUrl: t.opt(t.str()), status: t.opt(t.str()) });
const eventType = t.enm('meeting.started', 'meeting.ended', 'recording.completed', 'recording.transcript_completed', 'endpoint.url_validation');

const capabilities = [
  outward('zoom.meetings.create', 'Create a Zoom meeting and return the join link', {
    in: { topic: t.str(), startTime: t.opt(t.ts()), durationMinutes: t.opt(t.int({ minimum: 1 })), timezone: t.opt(t.str()), agenda: t.opt(t.str()), hostEmail: t.opt(email), autoRecord: t.opt(t.enm('none', 'local', 'cloud')) },
    out: { meeting: zoomMeeting }, gate: quiet('Creates a meeting in the Space Zoom account; nobody is invited until a calendar event is sent'), tool: 'inbox', deferred: true, errors: ['provider.auth_failed'],
  }),
  read('zoom.meetings.list', 'List meetings of a host', {
    in: { hostEmail: t.opt(email), type: t.opt(t.enm('scheduled', 'live', 'upcoming', 'previous')), pageToken: t.opt(t.str()), ...pageIn },
    out: { meetings: t.arr(zoomMeeting), nextPageToken: t.opt(t.str()) }, tool: 'inbox', deferred: true,
  }),
  read('zoom.meetings.get', 'Read one meeting', { in: { meetingId: t.str() }, out: { meeting: zoomMeeting }, tool: 'inbox', deferred: true }),
  outward('zoom.meetings.update', 'Change a Zoom meeting (time, topic, agenda)', {
    in: { meetingId: t.str(), topic: t.opt(t.str()), startTime: t.opt(t.ts()), durationMinutes: t.opt(t.int()), agenda: t.opt(t.str()) }, out: { meeting: zoomMeeting },
    gate: quiet('Changes a meeting in the Space Zoom account; nobody is notified by this call'), tool: 'inbox', deferred: true,
  }),
  outward('zoom.meetings.delete', 'Delete a Zoom meeting', { in: { meetingId: t.str() }, out: { deleted: t.bool() }, gate: 'delete', tool: 'inbox', deferred: true }),
  read('zoom.recordings.list', 'List cloud recordings in a time range', {
    in: { from: t.str(), to: t.str(), hostEmail: t.opt(email), pageToken: t.opt(t.str()) },
    out: { meetings: t.arr(t.obj({ meetingId: t.str(), uuid: t.str(), topic: t.str(), startTime: t.ts(), files: t.arr(recordingFile) })), nextPageToken: t.opt(t.str()) }, tool: 'inbox', deferred: true,
  }),
  read('zoom.recordings.get', 'Recording files of one meeting', { in: { meetingId: t.str() }, out: { files: t.arr(recordingFile), shareUrl: t.opt(t.str()) }, tool: 'inbox', deferred: true }),
  write('zoom.recordings.download', 'Download a recording file into Files (a Run; large files)', {
    in: { meetingId: t.str(), recordingFileId: t.str(), folderId: t.opt(id.folder) }, out: { runId: id.run }, run: { kind: 'zoom_recording_download', stoppable: true }, idem: 'natural', tool: 'inbox', deferred: true,
  }),
  read('zoom.transcripts.get', 'Transcript text (VTT) of a recorded meeting', { in: { meetingId: t.str() }, out: { vtt: t.str(), language: t.opt(t.str()) }, tool: 'inbox', deferred: true }),
  read('zoom.users.me', 'The authorised Zoom account user (health and account id)', { in: {}, out: { id: t.str(), email, accountId: t.opt(t.str()) } }),
  read('zoom.health', 'Health probe: GET /users/me', { in: {}, out: healthOut }),
  write('zoom.receive_webhook', 'Record a verified Zoom event after dedupe; answers the endpoint.url_validation challenge; hands meetings to meetings.ingest and recordings to meetings.attach_recording', {
    in: { eventId: t.str(), type: eventType, meetingId: t.opt(t.str()), uuid: t.opt(t.str()), plainToken: t.opt(t.str()), at: t.ts() },
    out: { accepted: t.bool(), encryptedToken: t.opt(t.str()) }, emits: ['zoom.event_received'], idem: 'natural', offline: 'online',
  }),
];

export default defineManifest({
  id: 'zoom',
  title: 'Zoom',
  kind: 'connector',
  owner: 'L5',
  events: [
    ev('zoom.event_received', 'A verified Zoom event arrived', { p: { eventId: t.str(), type: eventType, meetingId: t.opt(t.str()) }, subject: ['entity', '/eventId'] }),
  ],
  capabilities,
  connectors: [
    conn('zoom', 'Zoom', {
      mode: 'api', scope: 'space',
      auth: { type: 'client_credentials', tokenUrl: 'https://zoom.us/oauth/token', scopes: ['meeting:read:admin', 'meeting:write:admin', 'recording:read:admin', 'user:read:admin'] },
      domains: ['api.zoom.us', 'zoom.us'],
      secrets: [{ name: 'Zoom_S2S', description: 'Server-to-Server OAuth account id, client id and client secret' }, { name: 'Zoom_Webhook_Secret', description: 'Secret token that signs /hooks/zoom' }],
      sources: [{ key: 'zoom', path: '/hooks/zoom', verify: 'hmac', event: 'zoom.event_received', dedupe: '/eventId' }],
      actions: capabilities.map((c) => c.name), rate: { rps: 10, burst: 20 }, health: 'zoom.account',
    }),
  ],
  health: [
    health('zoom.account', 'Zoom', 'zoom.health', 'Check the Zoom_S2S item in the Vault and that the Zoom app is activated.', { pauses: ['sync'] }),
  ],
});
