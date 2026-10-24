# zoom.meetings.get

Read one meeting

| | |
|---|---|
| Module | zoom |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/zoom/meetings/get |
| MCP tool | zoom_meetings_get (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  meetingId: string;
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
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "meetingId": "example"
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
