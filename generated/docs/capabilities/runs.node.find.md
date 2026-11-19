# runs.node.find

The nodes that stand for given threads and idempotency keys (for a tile to read its node), only those the person may see

| | |
|---|---|
| Module | runs |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/runs/node/find |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadIds?: Array<string>;
  keys?: Array<string>;
};
```

## Output

```ts
type Out = {
  byThread: Record<string, string>;
  byKey: Record<string, string>;
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
    "keys": [
      "example"
    ],
    "threadIds": [
      "thr_a1b2c3"
    ]
  },
  "output": {
    "byKey": {},
    "byThread": {}
  }
}
```
