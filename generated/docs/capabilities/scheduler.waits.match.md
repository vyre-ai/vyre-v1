# scheduler.waits.match

Match an event against open waits by event type and filter hash and wake the thread, step or Journey (called by the event consumer)

| | |
|---|---|
| Module | scheduler-api |
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
| HTTP | POST /v1/scheduler/waits/match |
| MCP tool | none |
| CLI | none |
| Emits | wait.matched, wait.canceled |

## Input

```ts
type In = {
  eventId: string;
};
```

## Output

```ts
type Out = {
  matched: number;
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
    "eventId": "evt_a1b2c3"
  },
  "output": {
    "matched": 1
  }
}
```
