# zoom.receive_webhook

Record a verified Zoom event after dedupe; answers the endpoint.url_validation challenge; hands meetings to meetings.ingest and recordings to meetings.attach_recording

| | |
|---|---|
| Module | zoom |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/zoom/receive_webhook |
| MCP tool | none |
| CLI | none |
| Emits | zoom.event_received |

## Input

```ts
type In = {
  eventId: string;
  type: "meeting.started" | "meeting.ended" | "recording.completed" | "recording.transcript_completed" | "endpoint.url_validation";
  meetingId?: string;
  uuid?: string;
  plainToken?: string;
  at: number;
};
```

## Output

```ts
type Out = {
  accepted: boolean;
  encryptedToken?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "at": 1760000000000,
    "eventId": "example",
    "meetingId": "example",
    "plainToken": "example",
    "type": "meeting.started",
    "uuid": "example"
  },
  "output": {
    "accepted": true,
    "encryptedToken": "example"
  }
}
```
