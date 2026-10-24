# ms.teams.recordings.get_recording

Download a Teams recording into a blob

| | |
|---|---|
| Module | microsoft |
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
| HTTP | POST /v1/ms/teams/recordings/get_recording |
| MCP tool | ms_teams_recordings_get_recording (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  onlineMeetingId: string;
  recordingId: string;
};
```

## Output

```ts
type Out = {
  blobId: string;
  size: number;
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
    "connectionId": "con_a1b2c3",
    "onlineMeetingId": "example",
    "recordingId": "example"
  },
  "output": {
    "blobId": "blb_a1b2c3",
    "size": 1
  }
}
```
