# zoom.transcripts.get

Transcript text (VTT) of a recorded meeting

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
| HTTP | POST /v1/zoom/transcripts/get |
| MCP tool | zoom_transcripts_get (inbox, deferred) |
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
  vtt: string;
  language?: string;
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
    "language": "example",
    "vtt": "example"
  }
}
```
