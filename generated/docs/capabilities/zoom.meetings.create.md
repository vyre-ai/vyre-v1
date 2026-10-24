# zoom.meetings.create

Create a Zoom meeting and return the join link

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
| HTTP | POST /v1/zoom/meetings/create |
| MCP tool | zoom_meetings_create (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  topic: string;
  startTime?: number;
  durationMinutes?: number;
  timezone?: string;
  agenda?: string;
  hostEmail?: string;
  autoRecord?: "none" | "local" | "cloud";
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
- provider.auth_failed
- provider.network
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "agenda": "example",
    "autoRecord": "none",
    "durationMinutes": 1,
    "hostEmail": "maya@example.com",
    "idempotencyKey": "idem_1",
    "startTime": 1760000000000,
    "timezone": "example",
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
