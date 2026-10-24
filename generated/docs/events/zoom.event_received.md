# zoom.event_received

A verified Zoom event arrived

| | |
|---|---|
| Module | zoom |
| Schema version | 1 |
| Subject | entity at /eventId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  eventId: string;
  type: "meeting.started" | "meeting.ended" | "recording.completed" | "recording.transcript_completed" | "endpoint.url_validation";
  meetingId?: string;
};
```
