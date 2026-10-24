# meetings.set_state

Mark a meeting live or ended from a provider or calendar signal

| | |
|---|---|
| Module | meetings |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | record (/meetingId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/meetings/set_state |
| MCP tool | none |
| CLI | none |
| Emits | meeting.started, meeting.ended |

## Input

```ts
type In = {
  meetingId: string;
  state: "live" | "ended";
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
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "meetingId": "rec_a1b2c3",
    "state": "live"
  },
  "output": {
    "meetingId": "rec_a1b2c3"
  }
}
```
