# Zoom (zoom)

Lane L5. Kind connector. Status stub. Version 0.1.0.

Requires: nothing.

## Capabilities (12)

- [zoom.health](../capabilities/zoom.health.md): Health probe: GET /users/me
- [zoom.meetings.create](../capabilities/zoom.meetings.create.md): Create a Zoom meeting and return the join link
- [zoom.meetings.delete](../capabilities/zoom.meetings.delete.md): Delete a Zoom meeting
- [zoom.meetings.get](../capabilities/zoom.meetings.get.md): Read one meeting
- [zoom.meetings.list](../capabilities/zoom.meetings.list.md): List meetings of a host
- [zoom.meetings.update](../capabilities/zoom.meetings.update.md): Change a Zoom meeting (time, topic, agenda)
- [zoom.receive_webhook](../capabilities/zoom.receive_webhook.md): Record a verified Zoom event after dedupe; answers the endpoint.url_validation challenge; hands meetings to meetings.ingest and recordings to meetings.attach_recording
- [zoom.recordings.download](../capabilities/zoom.recordings.download.md): Download a recording file into Files (a Run; large files)
- [zoom.recordings.get](../capabilities/zoom.recordings.get.md): Recording files of one meeting
- [zoom.recordings.list](../capabilities/zoom.recordings.list.md): List cloud recordings in a time range
- [zoom.transcripts.get](../capabilities/zoom.transcripts.get.md): Transcript text (VTT) of a recorded meeting
- [zoom.users.me](../capabilities/zoom.users.me.md): The authorised Zoom account user (health and account id)

## Events (1)

- [zoom.event_received](../events/zoom.event_received.md): A verified Zoom event arrived
