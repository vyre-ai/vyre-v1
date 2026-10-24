# meetings.cancel

Cancel a meeting and its calendar event

| | |
|---|---|
| Module | meetings |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | records.edit |
| Grant level | edit |
| Risk | medium |
| Resource | record (/meetingId) |
| Gate | send when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/meetings/cancel |
| MCP tool | meetings_cancel (inbox) |
| CLI | none |
| Emits | meeting.canceled |

## Input

```ts
type In = {
  meetingId: string;
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
    "meetingId": "rec_a1b2c3"
  },
  "output": {
    "meetingId": "rec_a1b2c3"
  }
}
```
