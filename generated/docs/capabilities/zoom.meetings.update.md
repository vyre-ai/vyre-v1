# zoom.meetings.update

Change a Zoom meeting (time, topic, agenda)

| | |
|---|---|
| Module | zoom |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/zoom/meetings/update |
| MCP tool | zoom_meetings_update (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  meetingId: string;
  topic?: string;
  startTime?: number;
  durationMinutes?: number;
  agenda?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  meeting: {
    id: string;
    uuid?: string;
    topic: string;
    startTime?: number;
    durationMinutes?: number;
    joinUrl: string;
    password?: string;
    hostEmail?: string;
    timezone?: string;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.network
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "agenda": "example",
    "durationMinutes": 1,
    "idempotencyKey": "idem_1",
    "meetingId": "example",
    "startTime": 1760000000000,
    "topic": "example"
  },
  "output": {
    "meeting": {
      "durationMinutes": 1,
      "hostEmail": "maya@example.com",
      "id": "81234567890",
      "joinUrl": "example",
      "password": "example",
      "startTime": 1760000000000,
      "timezone": "example",
      "topic": "example",
      "uuid": "example"
    }
  }
}
```
