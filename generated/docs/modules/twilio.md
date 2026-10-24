# Twilio (twilio)

Lane L5. Kind connector. Status stub. Version 0.1.0.

Requires: telephony.

## Capabilities (21)

- [twilio.a2p.attach_number](../capabilities/twilio.a2p.attach_number.md): Attach a number to the registered messaging service
- [twilio.a2p.create_brand](../capabilities/twilio.a2p.create_brand.md): Register the Space brand for US texting
- [twilio.a2p.create_campaign](../capabilities/twilio.a2p.create_campaign.md): Register the texting campaign (use case, sample messages, opt-in) under the brand
- [twilio.a2p.status](../capabilities/twilio.a2p.status.md): Status of the brand and campaign registration
- [twilio.access_token](../capabilities/twilio.access_token.md): Mint a short-lived Voice JS SDK access token (the softphone asks telephony.voice_token, which calls this)
- [twilio.call.create](../capabilities/twilio.call.create.md): Place an outbound call (agent numbers and bridged softphone calls)
- [twilio.call.get](../capabilities/twilio.call.get.md): Read a call from Twilio
- [twilio.call.update](../capabilities/twilio.call.update.md): Change a live call: hang up, hold, resume or redirect to a teammate or agent
- [twilio.health](../capabilities/twilio.health.md): Health probe: GET /Accounts/{sid}
- [twilio.number.buy](../capabilities/twilio.number.buy.md): Buy a number
- [twilio.number.configure](../capabilities/twilio.number.configure.md): Point a number at the Space webhooks and the TwiML app
- [twilio.number.list_owned](../capabilities/twilio.number.list_owned.md): List numbers in the Twilio account
- [twilio.number.release](../capabilities/twilio.number.release.md): Release a number
- [twilio.number.search](../capabilities/twilio.number.search.md): Search Twilio inventory for numbers to buy
- [twilio.receive_webhook](../capabilities/twilio.receive_webhook.md): Record a verified Twilio webhook (voice, sms, status, recording) after signature check and dedupe, and hand it to telephony
- [twilio.recording.delete](../capabilities/twilio.recording.delete.md): Delete a recording at Twilio
- [twilio.recording.download](../capabilities/twilio.recording.download.md): Download a finished recording into a blob
- [twilio.recording.start](../capabilities/twilio.recording.start.md): Start recording a live call
- [twilio.recording.stop](../capabilities/twilio.recording.stop.md): Stop recording a live call
- [twilio.sms.send](../capabilities/twilio.sms.send.md): Send a text (the transport behind telephony.send_sms)
- [twilio.twiml_app.ensure](../capabilities/twilio.twiml_app.ensure.md): Find or create the TwiML app of this Space for the Voice JS SDK

## Events (4)

- [twilio.recording_received](../events/twilio.recording_received.md): A verified recording callback arrived
- [twilio.sms_received](../events/twilio.sms_received.md): A verified incoming-text webhook arrived
- [twilio.status_received](../events/twilio.status_received.md): A verified call or text status callback arrived
- [twilio.voice_received](../events/twilio.voice_received.md): A verified incoming-call webhook arrived
