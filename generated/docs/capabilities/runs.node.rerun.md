# runs.node.rerun

Start a finished helper again beside the first, with an edited brief or another model; both are kept and read side by side with runs.node.compare

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
| HTTP | POST /v1/runs/node/rerun |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  runId: string;
  goal?: string;
  instructions?: string;
  model?: string;
};
```

## Output

```ts
type Out = {
  threadId: string;
  rerunOf: string;
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
    "goal": "example",
    "instructions": "example",
    "model": "example",
    "runId": "run_a1b2c3"
  },
  "output": {
    "rerunOf": "run_a1b2c3",
    "threadId": "thr_a1b2c3"
  }
}
```
