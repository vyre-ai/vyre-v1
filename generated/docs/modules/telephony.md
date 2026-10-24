# Calls and texts (telephony)

Lane L5. Kind module. Status stub. Version 0.1.0.

Requires: mail.

## Capabilities (32)

- [telephony.answer](../capabilities/telephony.answer.md): Answer a ringing call
- [telephony.call.attach_summary](../capabilities/telephony.call.attach_summary.md): Attach a transcript and summary to a call (an Automation AI step or an agent writes it)
- [telephony.call.get](../capabilities/telephony.call.get.md): Read one call with transcript, summary and recording
- [telephony.call.list](../capabilities/telephony.call.list.md): List calls and voicemails (the Calls only view)
- [telephony.call.log_task](../capabilities/telephony.call.log_task.md): Log a task from a call
- [telephony.decline](../capabilities/telephony.decline.md): Decline a ringing call, optionally to voicemail
- [telephony.dial](../capabilities/telephony.dial.md): Place a call from a number (the softphone connects through the Voice SDK with the returned parameters)
- [telephony.hangup](../capabilities/telephony.hangup.md): End a call
- [telephony.hold](../capabilities/telephony.hold.md): Put a call on hold or take it off hold
- [telephony.ingest_recording](../capabilities/telephony.ingest_recording.md): Download a finished recording or voicemail into Files and attach it to the call
- [telephony.ingest_sms](../capabilities/telephony.ingest_sms.md): Land an incoming text; STOP and UNSUBSCRIBE suppress the sender and link the contact
- [telephony.ingest_status](../capabilities/telephony.ingest_status.md): Apply a call or text status callback (ended, missed, voicemail, delivered, undelivered, failed)
- [telephony.ingest_voice](../capabilities/telephony.ingest_voice.md): Land an incoming call and answer with the routing instruction for the number, hours and consent
- [telephony.number.assign](../capabilities/telephony.number.assign.md): Assign a number to a person, an agent or a shared inbox
- [telephony.number.buy](../capabilities/telephony.number.buy.md): Buy a number from Twilio and assign it
- [telephony.number.get](../capabilities/telephony.number.get.md): Read one number
- [telephony.number.import](../capabilities/telephony.number.import.md): Bring numbers that already exist in the Twilio account into the Space
- [telephony.number.list](../capabilities/telephony.number.list.md): List numbers with assignee, route and registration state
- [telephony.number.release](../capabilities/telephony.number.release.md): Release a number back to Twilio
- [telephony.number.search](../capabilities/telephony.number.search.md): Search Twilio for numbers that can be bought
- [telephony.number.set_hours](../capabilities/telephony.number.set_hours.md): Set the hours of a number and what happens outside them
- [telephony.number.set_recording](../capabilities/telephony.number.set_recording.md): Set the recording policy of a number: off, announce or ask
- [telephony.number.set_route](../capabilities/telephony.number.set_route.md): Set who rings, for how long, and whether voicemail with a transcript follows
- [telephony.record](../capabilities/telephony.record.md): Start or stop recording a call; consent (announcement or ask) is logged
- [telephony.registration.get](../capabilities/telephony.registration.get.md): Read the US texting registration (brand and campaign) for this Space
- [telephony.registration.refresh](../capabilities/telephony.registration.refresh.md): Pull the latest registration status from Twilio
- [telephony.registration.save](../capabilities/telephony.registration.save.md): Save the registration draft step by step
- [telephony.registration.submit](../capabilities/telephony.registration.submit.md): Submit the Space's brand and campaign registration to Twilio
- [telephony.send_sms](../capabilities/telephony.send_sms.md): Send a text through the single send API: suppression, SMS consent, send window, caps, Gate for agents and automations
- [telephony.sms.list](../capabilities/telephony.sms.list.md): List texts for a number or contact
- [telephony.transfer](../capabilities/telephony.transfer.md): Transfer a call to a teammate or an agent (warm or cold)
- [telephony.voice_token](../capabilities/telephony.voice_token.md): Mint a short-lived Voice SDK token for the softphone (TwiML app per Space)

## Events (16)

- [call.ended](../events/call.ended.md): A call ended
- [call.missed](../events/call.missed.md): An incoming call was not answered
- [call.recording_changed](../events/call.recording_changed.md): Recording started or stopped, with the consent that was logged
- [call.recording_ready](../events/call.recording_ready.md): A call recording was saved to Files
- [call.ringing](../events/call.ringing.md): An incoming call is ringing for someone
- [call.started](../events/call.started.md): A call connected
- [call.transcript_ready](../events/call.transcript_ready.md): A transcript and summary were attached to a call
- [call.transferred](../events/call.transferred.md): A call moved to a teammate or an agent
- [call.voicemail_left](../events/call.voicemail_left.md): A caller left a voicemail
- [number.assigned](../events/number.assigned.md): A number was assigned to a person, an agent or a shared inbox
- [number.purchased](../events/number.purchased.md): A number was bought and added to the Space
- [number.released](../events/number.released.md): A number was released back to Twilio
- [number.route_changed](../events/number.route_changed.md): A number route, hours or recording policy changed
- [registration.status_changed](../events/registration.status_changed.md): The texting registration changed status
- [registration.submitted](../events/registration.submitted.md): The US texting registration was submitted
- [sms.received](../events/sms.received.md): A text arrived on a number
