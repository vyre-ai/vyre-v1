# meetings.prep.start

Ask your Assistant to prepare for an event from the attendees' records and your past meetings with them

| | |
|---|---|
| Module | meetings |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/meetings/prep/start |
| MCP tool | meetings_prep_start (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  eventId: string;
};
```

## Output

```ts
type Out = {
  state: "none" | "working" | "ready";
  taskId?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "eventId": "cev_a1b2c3"
  },
  "output": {
    "state": "none",
    "taskId": "tsk_a1b2c3"
  }
}
```
