# meetings.closeout.prepare

Have the meeting owner's Assistant prepare the close-out from the transcript; redo starts it again without duplicating what was approved

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
| HTTP | POST /v1/meetings/closeout/prepare |
| MCP tool | meetings_closeout_prepare (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  meetingId: string;
  redo?: boolean;
};
```

## Output

```ts
type Out = {
  meetingId: string;
  state: "preparing" | "ready" | "closed" | "nothing";
  taskId?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "meetingId": "rec_a1b2c3",
    "redo": true
  },
  "output": {
    "meetingId": "rec_a1b2c3",
    "state": "preparing",
    "taskId": "tsk_a1b2c3"
  }
}
```
