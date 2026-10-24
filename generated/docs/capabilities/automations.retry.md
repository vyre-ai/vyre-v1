# automations.retry

Retry a failed run of this Automation from the start or from a step

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
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/automations/retry |
| MCP tool | automations_retry (automations) |
| CLI | none |
| Emits | automation.run_started |

## Input

```ts
type In = {
  automationId: string;
  runId: string;
  fromStep?: string;
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
    "fromStep": "example",
    "runId": "run_a1b2c3"
  },
  "output": {
    "runId": "run_a1b2c3"
  }
}
```
