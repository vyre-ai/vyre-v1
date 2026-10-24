# Twilio

Key twilio, module twilio. Mode api, owned by a space. Auth api_key.

## Egress domains

- api.twilio.com
- *.twilio.com

## Secrets (names only)

- Twilio_Account: Twilio Account SID
- Twilio_Auth: Auth token, or the API key secret when an API key is used
- Twilio_API_Key: Optional API key SID (used with the API key secret)

## Webhook sources

- /hooks/twilio/voice (signature) emits twilio.voice_received
- /hooks/twilio/sms (signature) emits twilio.sms_received
- /hooks/twilio/status (signature) emits twilio.status_received
- /hooks/twilio/recording (signature) emits twilio.recording_received

## Actions

- twilio.number.list_owned
- twilio.number.search
- twilio.number.buy
- twilio.number.release
- twilio.number.configure
- twilio.twiml_app.ensure
- twilio.access_token
- twilio.call.create
- twilio.call.get
- twilio.call.update
- twilio.recording.start
- twilio.recording.stop
- twilio.recording.download
- twilio.recording.delete
- twilio.sms.send
- twilio.a2p.create_brand
- twilio.a2p.create_campaign
- twilio.a2p.status
- twilio.a2p.attach_number
- twilio.health
- twilio.receive_webhook
- telephony.dial
- telephony.send_sms
- telephony.transfer
- telephony.record

## Synced types

