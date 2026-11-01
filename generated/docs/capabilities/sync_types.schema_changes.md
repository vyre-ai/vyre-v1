# sync_types.schema_changes

Remote schema changes waiting for review (for example 3 changes to review)

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | connectors.manage |
| Grant level | view |
| Risk | low |
| Resource | record_type (/type) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sync_types/schema_changes |
| MCP tool | sync_types_schema_changes (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: string;
};
```

## Output

```ts
type Out = {
  changes: Array<{
      changeKey: string;
      kind: "field_added" | "field_removed" | "field_retyped" | "object_removed";
      remote: string;
      summary: string;
    }>;
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
    "type": "contact"
  },
  "output": {
    "changes": [
      {
        "changeKey": "example",
        "kind": "field_added",
        "remote": "example",
        "summary": "example"
      }
    ]
  }
}
```
