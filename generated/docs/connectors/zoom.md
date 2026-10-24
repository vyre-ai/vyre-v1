# Zoom

Key zoom, module zoom. Mode api, owned by a space. Auth client_credentials.

## Egress domains

- api.zoom.us
- zoom.us

## Secrets (names only)

- Zoom_S2S: Server-to-Server OAuth account id, client id and client secret
- Zoom_Webhook_Secret: Secret token that signs /hooks/zoom

## Webhook sources

- /hooks/zoom (hmac) emits zoom.event_received

## Actions

- zoom.meetings.create
- zoom.meetings.list
- zoom.meetings.get
- zoom.meetings.update
- zoom.meetings.delete
- zoom.recordings.list
- zoom.recordings.get
- zoom.recordings.download
- zoom.transcripts.get
- zoom.users.me
- zoom.health
- zoom.receive_webhook

## Synced types

