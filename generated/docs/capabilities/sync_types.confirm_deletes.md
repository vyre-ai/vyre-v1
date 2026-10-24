# sync_types.confirm_deletes

Decide what happens when many records vanished at the source: mark them removed or keep them

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | record_type (/type) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/sync_types/confirm_deletes |
| MCP tool | sync_types_confirm_deletes (records) |
| CLI | none |
| Emits | sync.type_updated |

## Input

```ts
type In = {
  type: string;
  decision: "mark_removed" | "keep";
};
```

## Output

```ts
type Out = {
  removed: number;
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
    "decision": "mark_removed",
    "type": "contact"
  },
  "output": {
    "removed": 1
  }
}
```
