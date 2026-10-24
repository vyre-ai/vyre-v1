# sync_types.resolve_conflict

Settle a sync conflict: keep ours, take theirs, or enter a value

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | records.edit |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sync_types/resolve_conflict |
| MCP tool | sync_types_resolve_conflict (records) |
| CLI | none |
| Emits | record.updated |

## Input

```ts
type In = {
  conflictId: string;
  resolution: "ours" | "theirs" | "value";
  value?: unknown;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  recordId: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "conflictId": "cfl_a1b2c3",
    "idempotencyKey": "idem_1",
    "resolution": "ours",
    "value": {}
  },
  "output": {
    "recordId": "rec_a1b2c3"
  }
}
```
