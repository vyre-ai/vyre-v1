# runs.replay

Replay a past Run in the sandbox: outward steps are recorded, never executed; sealed and Restricted values are synthetic unless the replayer holds clearance

| | |
|---|---|
| Module | runs |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | server.logs |
| Grant level | edit |
| Risk | medium |
| Resource | run (/runId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/runs/replay |
| MCP tool | runs_replay (automations) |
| CLI | none |
| Emits | run.started |

## Input

```ts
type In = {
  runId: string;
  version?: "same" | "current";
  withClearance?: boolean;
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
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "runId": "run_a1b2c3",
    "version": "same",
    "withClearance": true
  },
  "output": {
    "runId": "run_a1b2c3"
  }
}
```
