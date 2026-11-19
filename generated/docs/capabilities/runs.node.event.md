# runs.node.event

Add one event to a node's log (idempotent by key; a usage event adds to the node's own spend once)

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
| HTTP | POST /v1/runs/node/event |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  runId: string;
  type: string;
  key?: string;
  actor?: string;
  payload?: unknown;
  at?: number;
};
```

## Output

```ts
type Out = {
  seq: number;
  duplicate: boolean;
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
  "input": {
    "actor": "example",
    "at": 1760000000000,
    "key": "example",
    "payload": {},
    "runId": "run_a1b2c3",
    "type": "example"
  },
  "output": {
    "duplicate": true,
    "seq": 1
  }
}
```
