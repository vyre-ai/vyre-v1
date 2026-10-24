# automations.fire

Start a run from a matched trigger event, checking self-trigger origin and the chain depth limit of 8 (called by the trigger consumer)

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | automation (/automationId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/automations/fire |
| MCP tool | none |
| CLI | none |
| Emits | automation.run_started, automation.trigger_dropped |

## Input

```ts
type In = {
  automationId: string;
  trigger: string;
  eventId?: string;
  payload: Record<string, unknown>;
  origin?: string;
  depth: number;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  runId?: string;
  dropped?: string;
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
    "automationId": "aut_a1b2c3",
    "depth": 1,
    "eventId": "evt_a1b2c3",
    "idempotencyKey": "idem_1",
    "origin": "example",
    "payload": {},
    "trigger": "example"
  },
  "output": {
    "dropped": "example",
    "runId": "run_a1b2c3"
  }
}
```
