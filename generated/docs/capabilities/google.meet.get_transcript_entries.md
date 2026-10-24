# google.meet.get_transcript_entries

Transcript entries (speaker, text, time)

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
| HTTP | POST /v1/google/meet/get_transcript_entries |
| MCP tool | google_meet_get_transcript_entries (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  transcript: string;
  pageToken?: string;
};
```

## Output

```ts
type Out = {
  entries: Array<{
      participant?: string;
      text: string;
      startTime?: string;
    }>;
  nextPageToken?: string;
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
    "pageToken": "example",
    "transcript": "example"
  },
  "output": {
    "entries": [
      {
        "participant": "example",
        "startTime": "example",
        "text": "example"
      }
    ],
    "nextPageToken": "example"
  }
}
```
