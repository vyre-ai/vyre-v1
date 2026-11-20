# runs.ops

Agent work: look, tell, steer; read the runs skill

| | |
|---|---|
| Module | runs |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | approve when runs.ops_gate(input) |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/runs/ops |
| MCP tool | runs_ops (agents) |
| CLI | none |
| Emits | run.node_state, run.node_ended, run.stopped |

## Input

```ts
type In = {
  action: string;
  id?: string;
  args?: Record<string, unknown>;
};
```

## Output

```ts
type Out = {
  result: unknown;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "action": "example",
    "args": {},
    "id": "example"
  },
  "output": {
    "result": {}
  }
}
```
