# google.meet.list_recordings

Recordings of a conference record (they also land in the organizer Drive)

| | |
|---|---|
| Module | google |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | connection (/connectionId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/google/meet/list_recordings |
| MCP tool | google_meet_list_recordings (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  conferenceRecord: string;
};
```

## Output

```ts
type Out = {
  recordings: Array<{
      name: string;
      state: string;
      driveFileId?: string;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "as": "maya@example.com",
    "conferenceRecord": "example",
    "connectionId": "con_a1b2c3"
  },
  "output": {
    "recordings": [
      {
        "driveFileId": "example",
        "name": "example",
        "state": "example"
      }
    ]
  }
}
```
