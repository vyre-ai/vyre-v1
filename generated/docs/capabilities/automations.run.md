# automations.run

Run an Automation now with a payload (the manual trigger or a button)

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
| HTTP | POST /v1/automations/run |
| MCP tool | automations_run (automations) |
| CLI | vyre automations run |
| Emits | automation.run_started |

## Input

```ts
type In = {
  automationId: string;
  payload?: Record<string, unknown>;
  trigger?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  runId: string;
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
    "idempotencyKey": "idem_1",
    "payload": {},
    "trigger": "example"
  },
  "output": {
    "runId": "run_a1b2c3"
  }
}
```
