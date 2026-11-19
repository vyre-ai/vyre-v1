# runs.node.reclaim

Put nodes whose worker stopped beating back in the queue with the next attempt (the host's sweep)

| | |
|---|---|
| Module | runs |
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
| HTTP | POST /v1/runs/node/reclaim |
| MCP tool | none |
| CLI | none |
| Emits | run.node_state, run.node_ended |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  reclaimed: Array<string>;
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
  "input": {},
  "output": {
    "reclaimed": [
      "run_a1b2c3"
    ]
  }
}
```
