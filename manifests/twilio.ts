// twilio (lane L5): Twilio connector. One account per Space (Account SID plus auth token or API key in the Vault).
// Voice, SMS, recordings, the Voice JS SDK access token with one TwiML app per Space, and the A2P registration helper.
// The semantics (routing, consent, suppression, conversations) live in the `telephony` module. ARCHITECTURE 8 table, spec 2.18.
// DECISION: webhooks arrive at /hooks/twilio/voice, /sms, /status and /recording; the X-Twilio-Signature header is checked,
// so the sources use verify 'signature'. Every webhook is deduped on a key built from the Sid plus the status.
// DECISION: telephony.* caps (dial, send_sms, transfer, record) are listed as actions this connector contributes.
import { conn, defineManifest, ev, health, outward, read, t, write } from '../packages/contracts/src/index.ts';
import { email } from './_common.ts';

const healthOut = { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()) };
const phone = t.str({ pattern: '^\\+[1-9][0-9]{6,14}$', examples: ['+14155550123'] });
const quiet = (what: string) => ({ act: 'none', reason: what });
const kind = t.enm('voice', 'sms', 'status', 'recording');
const ownedNumber = t.obj({ sid: t.str(), e164: phone, friendlyName: t.opt(t.str()), capabilities: t.arr(t.str()), voiceUrl: t.opt(t.str()), smsUrl: t.opt(t.str()), statusUrl: t.opt(t.str()) });
const brandFields = {
  legalName: t.str(), ein: t.opt(t.str()), website: t.opt(t.str()), vertical: t.opt(t.str()),
  address: t.opt(t.obj({ line1: t.str(), city: t.str(), region: t.str(), postal: t.str(), country: t.str() })), contactName: t.opt(t.str()), contactEmail: t.opt(email),
};

const capabilities = [
  read('twilio.number.list_owned', 'List numbers in the Twilio account', { in: {}, out: { numbers: t.arr(ownedNumber) }, perm: 'comms.numbers' }),
  read('twilio.number.search', 'Search Twilio inventory for numbers to buy', {
    in: { country: t.str({ examples: ['US'] }), areaCode: t.opt(t.str()), contains: t.opt(t.str()), capabilities: t.opt(t.arr(t.enm('voice', 'sms', 'mms'))), limit: t.opt(t.int({ minimum: 1, maximum: 30 })) },
    out: { available: t.arr(t.obj({ e164: phone, locality: t.opt(t.str()), region: t.opt(t.str()), capabilities: t.arr(t.str()) })) }, perm: 'comms.numbers',
  }),
  outward('twilio.number.buy', 'Buy a number', { in: { e164: phone, friendlyName: t.opt(t.str()) }, out: { number: ownedNumber }, perm: 'comms.numbers', gate: 'pay', errors: ['provider.auth_failed', 'validation.duplicate'] }),
  outward('twilio.number.release', 'Release a number', { in: { sid: t.str() }, out: { released: t.bool() }, perm: 'comms.numbers', gate: 'delete' }),
  outward('twilio.number.configure', 'Point a number at the Space webhooks and the TwiML app', {
    in: { sid: t.str(), voiceUrl: t.opt(t.str()), smsUrl: t.opt(t.str()), statusUrl: t.opt(t.str()), twimlAppSid: t.opt(t.str()) }, out: { number: ownedNumber }, perm: 'comms.numbers',
    gate: quiet('Changes webhook addresses on a number the Space owns; nothing is sent to anyone'),
  }),
  outward('twilio.twiml_app.ensure', 'Find or create the TwiML app of this Space for the Voice JS SDK', {
    in: { voiceUrl: t.str() }, out: { appSid: t.str() }, perm: 'comms.numbers', gate: quiet('Creates the Space TwiML app in its own Twilio account; nothing is sent to anyone'),
  }),
  read('twilio.access_token', 'Mint a short-lived Voice JS SDK access token (the softphone asks telephony.voice_token, which calls this)', {
    in: { identity: t.str(), ttlSec: t.opt(t.int({ minimum: 60, maximum: 86400 })) }, out: { token: t.str(), expiresAt: t.ts() }, risk: 'medium', audit: 'sensitive',
  }),
  outward('twilio.call.create', 'Place an outbound call (agent numbers and bridged softphone calls)', {
    in: { from: phone, to: phone, url: t.opt(t.str()), record: t.opt(t.bool()), statusCallback: t.opt(t.str()) }, out: { sid: t.str() }, gate: 'send', errors: ['provider.auth_failed', 'provider.rate_limited'],
  }),
  read('twilio.call.get', 'Read a call from Twilio', { in: { sid: t.str() }, out: { status: t.str(), durationSec: t.opt(t.int()), from: t.str(), to: t.str() } }),
  outward('twilio.call.update', 'Change a live call: hang up, hold, resume or redirect to a teammate or agent', {
    in: { sid: t.str(), action: t.enm('hangup', 'hold', 'resume', 'redirect'), targetUrl: t.opt(t.str()) }, out: { status: t.str() },
    gate: quiet('Acts on a call already in progress with a member of the Space; no new party is contacted'),
  }),
  outward('twilio.recording.start', 'Start recording a live call', {
    in: { callSid: t.str(), announced: t.bool() }, out: { recordingSid: t.str() }, gate: quiet('Recording of a call in progress; consent was logged by telephony.record'), errors: ['validation.precondition_failed'],
  }),
  outward('twilio.recording.stop', 'Stop recording a live call', { in: { callSid: t.str(), recordingSid: t.str() }, out: { stopped: t.bool() }, gate: quiet('Stops a recording on a call in progress') }),
  read('twilio.recording.download', 'Download a finished recording into a blob', { in: { recordingSid: t.str() }, out: { blobId: t.id('blb'), size: t.int(), durationSec: t.opt(t.int()) } }),
  outward('twilio.recording.delete', 'Delete a recording at Twilio', { in: { recordingSid: t.str() }, out: { deleted: t.bool() }, gate: 'delete' }),
  outward('twilio.sms.send', 'Send a text (the transport behind telephony.send_sms)', {
    in: { from: phone, to: phone, body: t.str(), mediaUrls: t.opt(t.arr(t.str())), statusCallback: t.opt(t.str()) }, out: { sid: t.str(), status: t.str() }, gate: 'send',
    errors: ['provider.auth_failed', 'provider.rate_limited'],
  }),
  outward('twilio.a2p.create_brand', 'Register the Space brand for US texting', {
    in: brandFields, out: { brandSid: t.str(), status: t.str() }, perm: 'comms.numbers', gate: quiet("Registers the Space's own texting brand with Twilio; nothing is sent to contacts"),
  }),
  outward('twilio.a2p.create_campaign', 'Register the texting campaign (use case, sample messages, opt-in) under the brand', {
    in: { brandSid: t.str(), useCase: t.str(), description: t.str(), sampleMessages: t.arr(t.str(), { minItems: 1 }), optInDescription: t.opt(t.str()), messagingServiceSid: t.opt(t.str()) },
    out: { campaignSid: t.str(), status: t.str() }, perm: 'comms.numbers', gate: quiet("Registers the Space's own texting campaign with Twilio; nothing is sent to contacts"),
  }),
  read('twilio.a2p.status', 'Status of the brand and campaign registration', {
    in: { brandSid: t.opt(t.str()), campaignSid: t.opt(t.str()) }, out: { brand: t.opt(t.str()), campaign: t.opt(t.str()), rejectedReason: t.opt(t.str()) }, perm: 'comms.numbers',
  }),
  outward('twilio.a2p.attach_number', 'Attach a number to the registered messaging service', {
    in: { messagingServiceSid: t.str(), numberSid: t.str() }, out: { attached: t.bool() }, perm: 'comms.numbers', gate: quiet('Links a Space number to its own messaging service; nothing is sent to anyone'),
  }),
  read('twilio.health', 'Health probe: GET /Accounts/{sid}', { in: {}, out: healthOut }),
  write('twilio.receive_webhook', 'Record a verified Twilio webhook (voice, sms, status, recording) after signature check and dedupe, and hand it to telephony', {
    in: { kind, dedupeKey: t.str(), sid: t.str(), params: t.rec(t.str()) }, out: { accepted: t.bool(), twiml: t.opt(t.str({ description: 'Response body Twilio expects for voice and sms webhooks' })) },
    emits: ['twilio.voice_received', 'twilio.sms_received', 'twilio.status_received', 'twilio.recording_received'], idem: 'natural', offline: 'online',
  }),
];

const received = (name: string, summary: string) => ev(name, summary, { p: { dedupeKey: t.str(), sid: t.str() }, subject: ['entity', '/sid'] });

export default defineManifest({
  id: 'twilio',
  title: 'Twilio',
  kind: 'connector',
  owner: 'L5',
  events: [
    received('twilio.voice_received', 'A verified incoming-call webhook arrived'),
    received('twilio.sms_received', 'A verified incoming-text webhook arrived'),
    received('twilio.status_received', 'A verified call or text status callback arrived'),
    received('twilio.recording_received', 'A verified recording callback arrived'),
  ],
  capabilities,
  connectors: [
    conn('twilio', 'Twilio', {
      mode: 'api', scope: 'space', auth: { type: 'api_key', secret: 'Twilio_Auth' }, domains: ['api.twilio.com', '*.twilio.com'],
      secrets: [
        { name: 'Twilio_Account', description: 'Twilio Account SID' }, { name: 'Twilio_Auth', description: 'Auth token, or the API key secret when an API key is used' },
        { name: 'Twilio_API_Key', description: 'Optional API key SID (used with the API key secret)' },
      ],
      sources: [
        { key: 'twilio_voice', path: '/hooks/twilio/voice', verify: 'signature', event: 'twilio.voice_received', dedupe: '/dedupeKey' },
        { key: 'twilio_sms', path: '/hooks/twilio/sms', verify: 'signature', event: 'twilio.sms_received', dedupe: '/dedupeKey' },
        { key: 'twilio_status', path: '/hooks/twilio/status', verify: 'signature', event: 'twilio.status_received', dedupe: '/dedupeKey' },
        { key: 'twilio_recording', path: '/hooks/twilio/recording', verify: 'signature', event: 'twilio.recording_received', dedupe: '/dedupeKey' },
      ],
      actions: [...capabilities.map((c) => c.name), 'telephony.dial', 'telephony.send_sms', 'telephony.transfer', 'telephony.record'],
      rate: { rps: 10, burst: 20 }, health: 'twilio.account',
    }),
  ],
  health: [
    health('twilio.account', 'Twilio', 'twilio.health', 'Check the Twilio_Account and Twilio_Auth items in the Vault.', { pauses: ['sends'] }),
  ],
});
