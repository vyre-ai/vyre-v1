# meetings.unmerge

Split a calendar event off a merged meeting

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
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/meetings/unmerge |
| MCP tool | meetings_unmerge (inbox) |
| CLI | none |
| Emits | meeting.unmerged |

## Input

```ts
type In = {
  meetingId: string;
  eventId: string;
};
```

## Output

```ts
type Out = {
  meetingId: string;
  newMeetingId?: string;
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
    "eventId": "cev_a1b2c3",
    "meetingId": "rec_a1b2c3"
  },
  "output": {
    "meetingId": "rec_a1b2c3",
    "newMeetingId": "rec_a1b2c3"
  }
}
```
