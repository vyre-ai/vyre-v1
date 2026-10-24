# runs.retry

Retry a failed or stopped Run from the start or from a step

| | |
|---|---|
| Module | runs |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | medium |
| Resource | run (/runId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/runs/retry |
| MCP tool | runs_retry (automations) |
| CLI | vyre runs retry |
| Emits | run.retried, run.started |

## Input

```ts
type In = {
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
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "fromStep": "example",
    "runId": "run_a1b2c3"
  },
  "output": {
    "runId": "run_a1b2c3"
  }
}
```
