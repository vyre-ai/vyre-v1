# ms.teams.recordings.list_recordings

Recordings of an online meeting

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
| HTTP | POST /v1/ms/teams/recordings/list_recordings |
| MCP tool | ms_teams_recordings_list_recordings (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  onlineMeetingId: string;
};
```

## Output

```ts
type Out = {
  recordings: Array<{
      id: string;
      createdAt?: string;
      contentUrl?: string;
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
    "connectionId": "con_a1b2c3",
    "onlineMeetingId": "example"
  },
  "output": {
    "recordings": [
      {
        "contentUrl": "example",
        "createdAt": "example",
        "id": "example"
      }
    ]
  }
}
```
