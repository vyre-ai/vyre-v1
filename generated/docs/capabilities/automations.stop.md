# automations.stop

Stop one run of an Automation, or all its running runs and pause it

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | medium |
| Resource | automation (/automationId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/automations/stop |
| MCP tool | automations_stop (automations) |
| CLI | none |
| Emits | automation.disabled |

## Input

```ts
type In = {
  automationId: string;
  runId?: string;
  pause?: boolean;
};
```

## Output

```ts
type Out = {
  stopped: number;
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
    "pause": true,
    "runId": "run_a1b2c3"
  },
  "output": {
    "stopped": 1
  }
}
```
