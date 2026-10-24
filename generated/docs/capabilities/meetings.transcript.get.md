# meetings.transcript.get

Transcript segments of a meeting

| | |
|---|---|
| Module | meetings |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | record (/meetingId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/meetings/transcript/get |
| MCP tool | meetings_transcript_get (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  meetingId: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  segments: Array<{
      startMs: number;
      endMs: number;
      speaker?: string;
      text: string;
    }>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "limit": 1,
    "meetingId": "rec_a1b2c3"
  },
  "output": {
    "next": "example",
    "segments": [
      {
        "endMs": 1,
        "speaker": "example",
        "startMs": 1,
        "text": "example"
      }
    ],
    "total": 1
  }
}
```
