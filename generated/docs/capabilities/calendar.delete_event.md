# calendar.delete_event

Delete an event (Undo in the title bar restores it)

| | |
|---|---|
| Module | calendar |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | entity (/eventId) |
| Gate | send when actor.kind != 'person' |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/calendar/delete_event |
| MCP tool | calendar_delete_event (inbox) |
| CLI | none |
| Emits | calendar_event.deleted |

## Input

```ts
type In = {
  eventId: string;
};
```

## Output

```ts
type Out = {
  deleted: boolean;
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
    "eventId": "cev_a1b2c3"
  },
  "output": {
    "deleted": true
  }
}
```
