# sync.snapshot.page

One page of a snapshot (up to 5000 rows, scoped to the person, rows carry field hlc and seq); sent as gzip NDJSON on the wire

| | |
|---|---|
| Module | sync |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | GET /sync/v1/snapshot/page |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  entity: string;
  after?: string;
  asOf: number;
};
```

## Output

```ts
type Out = {
  rows: Array<Record<string, unknown>>;
  last?: string;
  done: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- timeout.deadline
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "after": "example",
    "asOf": 1,
    "entity": "example"
  },
  "output": {
    "done": true,
    "last": "example",
    "rows": [
      {}
    ]
  }
}
```
