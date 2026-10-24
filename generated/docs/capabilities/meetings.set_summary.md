# meetings.set_summary

Write or correct the summary and decisions of a meeting

| | |
|---|---|
| Module | meetings |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | records.edit |
| Grant level | edit |
| Risk | medium |
| Resource | record (/meetingId) |
| Gate | none |
| Idempotency | natural |
| Offline | patch |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/meetings/set_summary |
| MCP tool | meetings_set_summary (inbox) |
| CLI | none |
| Emits | meeting.summary_ready |

## Input

```ts
type In = {
  meetingId: string;
  summary?: string;
  decisions?: string;
};
```

## Output

```ts
type Out = {
  meetingId: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "decisions": "example",
    "meetingId": "rec_a1b2c3",
    "summary": "example"
  },
  "output": {
    "meetingId": "rec_a1b2c3"
  }
}
```
