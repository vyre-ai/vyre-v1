// telephony (lane L5): Twilio-backed calls, texts, the softphone, number routes and hours, recording consent and the
// US texting registration flow. One Twilio account per Space (connector `twilio`). Spec 2.18 (Calls and SMS, Call
// routing and recording), 3.3 flow 3, 2.19 (sending side).
// DECISION: texting goes through telephony.send_sms (the SMS half of the single send API). It checks the same
// suppression list (contacts.suppression.check), SMS consent and send windows as mail.send.
// DECISION: telephony.transfer stays a write because spec 2.18 limits transfer targets to teammates and agents.
// DECISION: a number purchase spends money, so telephony.number.buy declares the Gate act 'pay'.
// DECISION: telephony emits message.sent, message.delivered, message.bounced and message.failed (declared in `mail`)
// with channel 'sms'; inbound texts use sms.received because chat already declares message.received.
import { defineManifest, entity, ev, outward, read, screen, setting, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut } from './_common.ts';

const smsId = t.id('sms');
const regId = t.id('reg');
const phone = t.str({ pattern: '^\\+[1-9][0-9]{6,14}$', examples: ['+14155550123'] });
const party = t.obj({ kind: t.enm('person', 'agent', 'group'), id: t.str({ examples: ['usr_a1b2c3'] }) });
const assigneeKind = t.enm('person', 'agent', 'inbox');
const recordingPolicy = t.enm('off', 'announce', 'ask');
const routeCfg = t.obj({ ring: t.arr(party), ringSeconds: t.int({ minimum: 5, maximum: 120 }), voicemail: t.bool(), voicemailTranscript: t.bool() });
const hoursCfg = t.obj({
  zone: t.str({ examples: ['America/Los_Angeles'] }), weekly: t.arr(t.obj({ day: t.int({ minimum: 0, maximum: 6 }), start: t.str({ examples: ['09:00'] }), end: t.str({ examples: ['17:00'] }) })),
  outsideHours: t.enm('voicemail', 'ring', 'reject'),
});
const numberRow = t.obj({
  id: id.number, e164: phone, title: t.str(), capabilities: t.arr(t.enm('voice', 'sms', 'mms')), assigneeKind, assigneeId: t.opt(t.str()), route: routeCfg, hours: hoursCfg,
  recording: recordingPolicy, a2p: t.enm('none', 'pending', 'approved', 'rejected'), state: t.enm('pending', 'active', 'released'),
});
const callState = t.enm('ringing', 'answered', 'voicemail', 'completed', 'missed', 'failed');
const callRow = t.obj({
  id: id.call, numberId: id.number, direction: t.enm('in', 'out'), from: t.str(), to: t.str(), contactId: t.opt(id.record), state: callState,
  startedAt: t.ts(), answeredAt: t.opt(t.ts()), endedAt: t.opt(t.ts()), durationSec: t.opt(t.int()), handledBy: t.opt(party), recordingFileId: t.opt(id.file),
  hasTranscript: t.bool(), summary: t.opt(t.str()), consentLogged: t.bool(),
});
const smsRow = t.obj({
  id: smsId, numberId: id.number, direction: t.enm('in', 'out'), from: t.str(), to: t.str(), body: t.str(), status: t.enm('queued', 'sent', 'delivered', 'undelivered', 'failed', 'received'),
  contactId: t.opt(id.record), mediaFileIds: t.arr(id.file), campaignId: t.opt(id.campaign), at: t.ts(),
});
const registrationFields = {
  legalName: t.str(), ein: t.opt(t.str()), website: t.opt(t.str()), address: t.opt(t.obj({ line1: t.str(), city: t.str(), region: t.str(), postal: t.str(), country: t.str() })),
  contactName: t.opt(t.str()), contactEmail: t.opt(t.str()), useCase: t.opt(t.str()), sampleMessages: t.opt(t.arr(t.str())), optInDescription: t.opt(t.str()),
};
const registrationRow = t.obj({
  id: regId, ...registrationFields, state: t.enm('draft', 'submitted', 'in_review', 'approved', 'rejected'), rejectedReason: t.opt(t.str()), submittedAt: t.opt(t.ts()),
});
const ringInstruction = t.obj({
  action: t.enm('ring', 'voicemail', 'reject', 'agent'), targets: t.arr(party), ringSeconds: t.opt(t.int()), greeting: t.opt(t.str()), record: t.bool(), announcement: t.opt(t.str()),
});

export default defineManifest({
  id: 'telephony',
  title: 'Calls and texts',
  owner: 'L5',
  entities: [
    entity('number', 'telephony_number', 'num_', {
      e164: 'phone', title: 'text', capabilities: 'multichoice', assigneeKind: 'choice', assigneeId: 'text', route: 'text', hours: 'text', recording: 'choice', a2p: 'choice', state: 'status', twilioSid: 'text',
    }, 'number', { ownerField: 'assigneeId', sync: { profile: { desktop: 'all', phone: 'all', web: 'all' }, protectedFields: ['assigneeId', 'recording', 'state'] } }),
    entity('call', 'telephony_call', 'cal_', {
      numberId: 'text', direction: 'choice', from: 'text', to: 'text', contactId: 'text', state: 'status', startedAt: 'datetime', answeredAt: 'datetime', endedAt: 'datetime', durationSec: 'duration',
      handledBy: 'text', recordingFileId: 'text', transcript: { type: 'longtext', label: 'confidential' }, summary: 'longtext', consentLogged: 'checkbox', twilioSid: 'text', traceId: 'text',
    }, 'number', { parent: { entity: 'number', field: 'numberId' }, parentField: 'numberId', fts: ['transcript', 'summary'], sync: { profile: { desktop: 'window', phone: 'window', web: 'window' }, window: { days: 90, recentCount: 300 }, maxLabel: 'confidential' } }),
    entity('sms', 'telephony_sms', 'sms_', {
      numberId: 'text', direction: 'choice', from: 'text', to: 'text', body: { type: 'longtext', label: 'confidential' }, status: 'status', contactId: 'text', mediaFileIds: 'files', campaignId: 'text', at: 'datetime', twilioSid: 'text', traceId: 'text',
    }, 'number', { parent: { entity: 'number', field: 'numberId' }, parentField: 'numberId', fts: ['body'], sync: { profile: { desktop: 'window', phone: 'window', web: 'window' }, window: { days: 90, recentCount: 500 }, maxLabel: 'confidential' } }),
    entity('texting_registration', 'telephony_registration', 'reg_', {
      legalName: 'text', ein: 'text', website: 'url', address: 'address', contactName: 'text', contactEmail: 'email', useCase: 'text', sampleMessages: 'longtext', optInDescription: 'longtext',
      state: 'status', rejectedReason: 'text', submittedAt: 'datetime', twilioBrandSid: 'text', twilioCampaignSid: 'text',
    }, 'space', { sync: { profile: { desktop: 'none', phone: 'none', web: 'none' } } }),
  ],
  events: [
    ev('call.ringing', 'An incoming call is ringing for someone', {
      p: { callId: id.call, numberId: id.number, from: t.str(), contactId: t.opt(id.record), ringing: t.arr(party) }, subject: ['entity', '/callId'], vis: 'participants', notify: 'call.incoming',
    }),
    ev('call.started', 'A call connected', { p: { callId: id.call, numberId: id.number, direction: t.enm('in', 'out'), contactId: t.opt(id.record) }, subject: ['entity', '/callId'], label: 'subject', replay: 'stub' }),
    ev('call.ended', 'A call ended', {
      p: { callId: id.call, numberId: id.number, direction: t.enm('in', 'out'), durationSec: t.int(), contactId: t.opt(id.record) }, subject: ['entity', '/callId'], label: 'subject', replay: 'stub',
      trigger: { title: 'A call ends', fields: ['/direction', '/numberId'] },
    }),
    ev('call.missed', 'An incoming call was not answered', { p: { callId: id.call, numberId: id.number, from: t.str(), contactId: t.opt(id.record) }, subject: ['entity', '/callId'], label: 'subject' }),
    ev('call.voicemail_left', 'A caller left a voicemail', { p: { callId: id.call, numberId: id.number, contactId: t.opt(id.record) }, subject: ['entity', '/callId'], label: 'subject' }),
    ev('call.transferred', 'A call moved to a teammate or an agent', { p: { callId: id.call, to: party, mode: t.enm('warm', 'cold') }, subject: ['entity', '/callId'], label: 'subject', replay: 'stub' }),
    ev('call.recording_changed', 'Recording started or stopped, with the consent that was logged', { p: { callId: id.call, recording: t.bool(), consentLogged: t.bool() }, subject: ['entity', '/callId'], label: 'subject', replay: 'stub' }),
    ev('call.recording_ready', 'A call recording was saved to Files', { p: { callId: id.call, fileId: id.file }, subject: ['entity', '/callId'], label: 'subject' }),
    ev('call.transcript_ready', 'A transcript and summary were attached to a call', { p: { callId: id.call, contactId: t.opt(id.record) }, subject: ['entity', '/callId'], label: 'subject', trigger: { title: 'A call transcript is ready' } }),
    ev('sms.received', 'A text arrived on a number', {
      p: { smsId, numberId: id.number, from: phone, contactId: t.opt(id.record), optOut: t.bool() }, subject: ['entity', '/smsId'], label: 'subject', trigger: { title: 'A text arrives', fields: ['/numberId', '/optOut'] },
    }),
    ev('number.purchased', 'A number was bought and added to the Space', { p: { numberId: id.number, e164: phone }, subject: ['number', '/numberId'], replay: 'stub' }),
    ev('number.released', 'A number was released back to Twilio', { p: { numberId: id.number, e164: phone }, subject: ['number', '/numberId'], replay: 'stub' }),
    ev('number.assigned', 'A number was assigned to a person, an agent or a shared inbox', { p: { numberId: id.number, assigneeKind, assigneeId: t.str() }, subject: ['number', '/numberId'] }),
    ev('number.route_changed', 'A number route, hours or recording policy changed', { p: { numberId: id.number, fields: t.arr(t.str()) }, subject: ['number', '/numberId'] }),
    ev('registration.submitted', 'The US texting registration was submitted', { p: { registrationId: regId }, subject: ['entity', '/registrationId'], replay: 'stub' }),
    ev('registration.status_changed', 'The texting registration changed status', { p: { registrationId: regId, state: t.enm('in_review', 'approved', 'rejected') }, subject: ['entity', '/registrationId'] }),
  ],
  capabilities: [
    // ---- numbers
    read('telephony.number.list', 'List numbers with assignee, route and registration state', {
      in: { assigneeId: t.opt(t.str()), ...pageIn }, out: { numbers: t.arr(numberRow), ...pageOut }, tool: 'inbox', label: 'filter',
    }),
    read('telephony.number.get', 'Read one number', { in: { numberId: id.number }, out: { number: numberRow }, on: ['number', '/numberId'], tool: 'inbox', label: 'check' }),
    read('telephony.number.search', 'Search Twilio for numbers that can be bought', {
      in: { country: t.str({ examples: ['US'] }), areaCode: t.opt(t.str()), contains: t.opt(t.str()), capabilities: t.opt(t.arr(t.enm('voice', 'sms', 'mms'))), limit: t.opt(t.int({ minimum: 1, maximum: 30 })) },
      out: { available: t.arr(t.obj({ e164: phone, locality: t.opt(t.str()), region: t.opt(t.str()), capabilities: t.arr(t.str()) })) }, perm: 'comms.numbers', tool: 'inbox', deferred: true,
    }),
    outward('telephony.number.buy', 'Buy a number from Twilio and assign it', {
      in: { e164: phone, title: t.str(), assigneeKind, assigneeId: t.opt(t.str()) }, out: { number: numberRow }, perm: 'comms.numbers', gate: 'pay', emits: ['number.purchased'],
      tool: 'inbox', errors: ['provider.auth_failed', 'validation.duplicate'],
    }),
    write('telephony.number.import', 'Bring numbers that already exist in the Twilio account into the Space', {
      in: { e164: t.opt(t.arr(phone)) }, out: { imported: t.int(), numbers: t.arr(numberRow) }, perm: 'comms.numbers', idem: 'key', tool: 'inbox', emits: ['number.assigned'],
    }),
    outward('telephony.number.release', 'Release a number back to Twilio', {
      in: { numberId: id.number }, out: { released: t.bool() }, on: ['number', '/numberId'], level: 'manage', perm: 'comms.numbers', gate: 'delete', emits: ['number.released'], tool: 'inbox',
    }),
    write('telephony.number.assign', 'Assign a number to a person, an agent or a shared inbox', {
      in: { numberId: id.number, assigneeKind, assigneeId: t.str() }, out: { number: numberRow }, on: ['number', '/numberId'], level: 'manage', perm: 'comms.numbers', emits: ['number.assigned'], tool: 'inbox',
    }),
    write('telephony.number.set_route', 'Set who rings, for how long, and whether voicemail with a transcript follows', {
      in: { numberId: id.number, route: routeCfg }, out: { number: numberRow }, on: ['number', '/numberId'], level: 'manage', perm: 'comms.numbers', emits: ['number.route_changed'], tool: 'inbox',
    }),
    write('telephony.number.set_hours', 'Set the hours of a number and what happens outside them', {
      in: { numberId: id.number, hours: hoursCfg }, out: { number: numberRow }, on: ['number', '/numberId'], level: 'manage', perm: 'comms.numbers', emits: ['number.route_changed'], tool: 'inbox',
    }),
    write('telephony.number.set_recording', 'Set the recording policy of a number: off, announce or ask', {
      in: { numberId: id.number, recording: recordingPolicy }, out: { number: numberRow }, on: ['number', '/numberId'], level: 'manage', perm: 'comms.numbers', emits: ['number.route_changed'], audit: 'always', tool: 'inbox',
    }),
    // ---- calls
    outward('telephony.dial', 'Place a call from a number (the softphone connects through the Voice SDK with the returned parameters)', {
      in: { numberId: id.number, to: phone, contactId: t.opt(id.record), record: t.opt(t.bool()) }, out: { callId: id.call, params: t.rec(t.str()) },
      on: ['number', '/numberId'], level: 'use', gate: 'send', emits: ['call.started'], tool: 'inbox', offline: 'online', cli: 'vyre call',
      errors: ['permission.needs_approval', 'validation.precondition_failed', 'provider.auth_failed'],
    }),
    write('telephony.answer', 'Answer a ringing call', { in: { callId: id.call }, out: { call: callRow }, emits: ['call.started'], tool: 'inbox', offline: 'online', level: 'use' }),
    write('telephony.decline', 'Decline a ringing call, optionally to voicemail', { in: { callId: id.call, toVoicemail: t.opt(t.bool()) }, out: { call: callRow }, emits: ['call.missed', 'call.voicemail_left'], tool: 'inbox', offline: 'online', level: 'use' }),
    write('telephony.hangup', 'End a call', { in: { callId: id.call }, out: { call: callRow }, emits: ['call.ended'], tool: 'inbox', offline: 'online', level: 'use' }),
    write('telephony.hold', 'Put a call on hold or take it off hold', { in: { callId: id.call, hold: t.bool() }, out: { call: callRow }, tool: 'inbox', offline: 'online', level: 'use' }),
    write('telephony.transfer', 'Transfer a call to a teammate or an agent (warm or cold)', {
      in: { callId: id.call, to: t.obj({ kind: t.enm('person', 'agent'), id: t.str() }), mode: t.enm('warm', 'cold') }, out: { call: callRow }, level: 'use', emits: ['call.transferred'],
      tool: 'inbox', offline: 'online', errors: ['validation.precondition_failed'],
    }),
    write('telephony.record', 'Start or stop recording a call; consent (announcement or ask) is logged', {
      in: { callId: id.call, action: t.enm('start', 'stop'), consent: t.opt(t.obj({ announced: t.bool(), confirmedBy: t.opt(t.str()) })) }, out: { recording: t.bool(), consentLogged: t.bool() },
      level: 'use', emits: ['call.recording_changed'], audit: 'always', tool: 'inbox', offline: 'online', errors: ['validation.precondition_failed'],
    }),
    read('telephony.call.list', 'List calls and voicemails (the Calls only view)', {
      in: { numberId: t.opt(id.number), contactId: t.opt(id.record), direction: t.opt(t.enm('in', 'out')), state: t.opt(callState), ...pageIn }, out: { calls: t.arr(callRow), ...pageOut },
      tool: 'inbox', label: 'filter',
    }),
    read('telephony.call.get', 'Read one call with transcript, summary and recording', {
      in: { callId: id.call }, out: { call: callRow, transcript: t.opt(t.str()) }, tool: 'inbox', label: 'check',
    }),
    write('telephony.call.log_task', 'Log a task from a call', {
      in: { callId: id.call, title: t.str(), assigneeId: t.opt(id.user), dueAt: t.opt(t.ts()) }, out: { taskId: id.task }, idem: 'key', tool: 'inbox',
    }),
    write('telephony.call.attach_summary', 'Attach a transcript and summary to a call (an Automation AI step or an agent writes it)', {
      in: { callId: id.call, transcript: t.opt(t.str()), summary: t.opt(t.str()) }, out: { call: callRow }, emits: ['call.transcript_ready'], tool: 'inbox',
    }),
    read('telephony.voice_token', 'Mint a short-lived Voice SDK token for the softphone (TwiML app per Space)', {
      in: { numberId: t.opt(id.number) }, out: { token: t.str(), identity: t.str(), expiresAt: t.ts() }, risk: 'medium', audit: 'sensitive', tool: 'inbox', deferred: true,
    }),
    // ---- texts
    outward('telephony.send_sms', 'Send a text through the single send API: suppression, SMS consent, send window, caps, Gate for agents and automations', {
      in: {
        numberId: id.number, to: phone, body: t.str(), mediaFileIds: t.opt(t.arr(id.file)), contactId: t.opt(id.record), replyToId: t.opt(smsId), campaignId: t.opt(id.campaign), sendAt: t.opt(t.ts()),
      },
      out: { smsId: t.opt(smsId), status: t.enm('queued', 'sent', 'held', 'suppressed'), taskId: t.opt(id.task) },
      on: ['number', '/numberId'], level: 'use', gate: 'send', emits: ['message.sent', 'message.suppressed', 'message.failed'], tool: 'inbox', offline: 'queue', cli: 'vyre sms send',
      errors: ['permission.needs_approval', 'validation.precondition_failed', 'rate_limit.exceeded', 'provider.auth_failed', 'provider.rate_limited'],
    }),
    read('telephony.sms.list', 'List texts for a number or contact', {
      in: { numberId: t.opt(id.number), contactId: t.opt(id.record), direction: t.opt(t.enm('in', 'out')), ...pageIn }, out: { messages: t.arr(smsRow), ...pageOut }, tool: 'inbox', label: 'filter',
    }),
    // ---- inbound pipeline (called by the twilio connector after signature check and dedupe)
    write('telephony.ingest_voice', 'Land an incoming call and answer with the routing instruction for the number, hours and consent', {
      in: { callSid: t.str(), from: t.str(), to: phone, status: t.str(), callerName: t.opt(t.str()), forwardedFrom: t.opt(t.str()) },
      out: { callId: id.call, instruction: ringInstruction }, emits: ['call.ringing'], idem: 'natural', offline: 'online',
    }),
    write('telephony.ingest_sms', 'Land an incoming text; STOP and UNSUBSCRIBE suppress the sender and link the contact', {
      in: { messageSid: t.str(), from: phone, to: phone, body: t.str(), mediaUrls: t.opt(t.arr(t.str())), at: t.ts() },
      out: { smsId, optOut: t.bool(), contactId: t.opt(id.record), conversationId: t.opt(t.id('cnv')) }, emits: ['sms.received'], idem: 'natural', offline: 'online',
    }),
    write('telephony.ingest_status', 'Apply a call or text status callback (ended, missed, voicemail, delivered, undelivered, failed)', {
      in: { sid: t.str(), kind: t.enm('call', 'sms'), status: t.str(), errorCode: t.opt(t.str()), durationSec: t.opt(t.int()), at: t.ts() },
      out: { applied: t.bool() }, emits: ['call.ended', 'call.missed', 'call.voicemail_left', 'message.delivered', 'message.bounced', 'message.failed'], idem: 'natural', offline: 'online',
    }),
    write('telephony.ingest_recording', 'Download a finished recording or voicemail into Files and attach it to the call', {
      in: { callSid: t.str(), recordingSid: t.str(), url: t.str(), durationSec: t.opt(t.int()) }, out: { callId: id.call, fileId: id.file }, emits: ['call.recording_ready'], idem: 'natural', offline: 'online',
    }),
    // ---- texting registration
    read('telephony.registration.get', 'Read the US texting registration (brand and campaign) for this Space', {
      in: {}, out: { registration: t.opt(registrationRow) }, perm: 'comms.numbers', tool: 'inbox',
    }),
    write('telephony.registration.save', 'Save the registration draft step by step', {
      in: registrationFields, out: { registration: registrationRow }, perm: 'comms.numbers', tool: 'inbox',
    }),
    outward('telephony.registration.submit', "Submit the Space's brand and campaign registration to Twilio", {
      in: { registrationId: regId }, out: { registration: registrationRow }, perm: 'comms.numbers', emits: ['registration.submitted'], tool: 'inbox',
      gate: { act: 'none', reason: "Registers the Space's own texting brand with Twilio. Nothing is sent to contacts." }, errors: ['validation.precondition_failed', 'provider.auth_failed'],
    }),
    write('telephony.registration.refresh', 'Pull the latest registration status from Twilio', {
      in: { registrationId: regId }, out: { registration: registrationRow }, perm: 'comms.numbers', emits: ['registration.status_changed'], tool: 'inbox',
    }),
  ],
  screens: [
    screen('telephony.softphone', 'inbox', 'ui:Softphone', {
      slot: 'popover',
      q: { numbers: ['telephony.number.list', {}, true], calls: ['telephony.call.list', { numberId: '/state/numberId' }, true], token: ['telephony.voice_token', { numberId: '/state/numberId' }, false] },
      a: {
        dial: ['telephony.dial', { numberId: '/state/numberId', to: '/state/to', contactId: '/state/contactId' }], answer: ['telephony.answer', { callId: '/state/callId' }],
        decline: ['telephony.decline', { callId: '/state/callId' }], hangup: ['telephony.hangup', { callId: '/state/callId' }], hold: ['telephony.hold', { callId: '/state/callId', hold: '/state/hold' }],
        transfer: ['telephony.transfer', { callId: '/state/callId', to: '/state/to', mode: '/state/mode' }], record: ['telephony.record', { callId: '/state/callId', action: '/state/action', consent: '/state/consent' }],
        logTask: ['telephony.call.log_task', { callId: '/state/callId', title: '/state/title' }],
      },
      empty: 'No calls yet', keys: [{ combo: 'Cmd-Shift-K', action: 'toggle' }],
    }),
    screen('telephony.incoming', 'inbox', 'ui:IncomingCallSheet', {
      slot: 'sheet',
      q: { call: ['telephony.call.get', { callId: '/state/callId' }, true] },
      a: { answer: ['telephony.answer', { callId: '/state/callId' }], decline: ['telephony.decline', { callId: '/state/callId', toVoicemail: '/state/toVoicemail' }] },
      empty: 'No call',
    }),
    screen('telephony.numbers', 'console', 'ui:ConsoleNumbers', {
      q: { numbers: ['telephony.number.list', {}, true], available: ['telephony.number.search', { country: '/state/country', areaCode: '/state/areaCode', contains: '/state/contains' }, false] },
      a: {
        buy: ['telephony.number.buy', { e164: '/state/e164', title: '/state/title', assigneeKind: '/state/assigneeKind', assigneeId: '/state/assigneeId' }],
        assign: ['telephony.number.assign', { numberId: '/state/numberId', assigneeKind: '/state/assigneeKind', assigneeId: '/state/assigneeId' }],
        route: ['telephony.number.set_route', { numberId: '/state/numberId', route: '/state/route' }], hours: ['telephony.number.set_hours', { numberId: '/state/numberId', hours: '/state/hours' }],
        recording: ['telephony.number.set_recording', { numberId: '/state/numberId', recording: '/state/recording' }],
        release: ['telephony.number.release', { numberId: '/state/numberId' }, 'Release this number back to Twilio?'], import: ['telephony.number.import', {}],
      },
      empty: 'No numbers yet', primary: 'Buy a number', needs: ['comms.numbers'],
    }),
    screen('telephony.registration', 'console', 'ui:TextingRegistration', {
      q: { registration: ['telephony.registration.get', {}, true] },
      a: { save: ['telephony.registration.save', { legalName: '/state/legalName', ein: '/state/ein', website: '/state/website', useCase: '/state/useCase' }], submit: ['telephony.registration.submit', { registrationId: '/state/registrationId' }], refresh: ['telephony.registration.refresh', { registrationId: '/state/registrationId' }] },
      empty: 'Texting is not registered yet', primary: 'Start registration', needs: ['comms.numbers'],
    }),
  ],
  settings: [
    setting('telephony.recording_default', 'space', 'comms', 'Default recording policy for new numbers', recordingPolicy, 'off'),
    setting('telephony.voicemail_transcript', 'space', 'comms', 'Transcribe voicemails', t.bool(), true),
  ],
});
