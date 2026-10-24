# conflicts.field_history

Previous values and merge losers of one field (field_history joined to resolutions)

| | |
|---|---|
| Module | conflicts |
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
| HTTP | POST /v1/conflicts/field_history |
| MCP tool | conflicts_field_history (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  entity: string;
  recordId: string;
  field: string;
};
```

## Output

```ts
type Out = {
  entries: Array<{
      value: unknown;
      hlc: string;
      actor: string;
      reason: "lww_loser" | "resolved" | "superseded";
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
  "input": {
    "entity": "example",
    "field": "example",
    "recordId": "example"
  },
  "output": {
    "entries": [
      {
        "actor": "example",
        "at": 1760000000000,
        "hlc": "example",
        "reason": "lww_loser",
        "value": {}
      }
    ]
  }
}
```
