# automations.test

Test an Automation with sample data: reads run for real, writes and sends are stubbed (a Run)

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
| HTTP | POST /v1/automations/test |
| MCP tool | automations_test (automations) |
| CLI | vyre automations test |
| Emits | automation.run_started |

## Input

```ts
type In = {
  automationId: string;
  trigger?: string;
  sample?: Record<string, unknown>;
  version?: number;
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
    "sample": {},
    "trigger": "example",
    "version": 1
  },
  "output": {
    "runId": "run_a1b2c3"
  }
}
```
