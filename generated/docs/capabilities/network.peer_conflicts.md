# network.peer_conflicts

What syncing between your computers had to settle: the same name made on two computers while apart (one copy is renamed, both are kept), or an item kept aside whole

| | |
|---|---|
| Module | network |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | use |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/network/peer_conflicts |
| MCP tool | network_peer_conflicts (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  conflicts: Array<{
      conflictId: string;
      table: string;
      rowKey: string;
      kind: "renamed" | "kept_aside";
      detail: string;
      at: number;
    }>;
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
    "conflicts": [
      {
        "at": 1760000000000,
        "conflictId": "example",
        "detail": "example",
        "kind": "renamed",
        "rowKey": "example",
        "table": "example"
      }
    ]
  }
}
```
