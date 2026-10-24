# meetings.match_attendees

Link attendee emails to contact records (sure matches link, unsure go to Needs you)

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
| HTTP | POST /v1/meetings/match_attendees |
| MCP tool | meetings_match_attendees (inbox) |
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
  matched: number;
  unsure: number;
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
    "meetingId": "rec_a1b2c3"
  },
  "output": {
    "matched": 1,
    "unsure": 1
  }
}
```
