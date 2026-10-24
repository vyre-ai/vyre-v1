# zoom.meetings.list

List meetings of a host

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
| HTTP | POST /v1/zoom/meetings/list |
| MCP tool | zoom_meetings_list (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  hostEmail?: string;
  type?: "scheduled" | "live" | "upcoming" | "previous";
  pageToken?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  meetings: Array<{
      id: string;
      uuid?: string;
      topic: string;
      startTime?: number;
      durationMinutes?: number;
      joinUrl: string;
      password?: string;
      hostEmail?: string;
      timezone?: string;
    }>;
  nextPageToken?: string;
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
    "cursor": "example",
    "hostEmail": "maya@example.com",
    "limit": 1,
    "pageToken": "example",
    "type": "scheduled"
  },
  "output": {
    "meetings": [
      {
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
    ],
    "nextPageToken": "example"
  }
}
```
