# schema.restore_field

Bring a dropped field back from Trash with its values

| | |
|---|---|
| Module | schema |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | schema.manage |
| Grant level | edit |
| Risk | medium |
| Resource | record_type (/type) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/schema/restore_field |
| MCP tool | schema_restore_field (engineer) |
| CLI | none |
| Emits | schema.field_restored, schema.changed |

## Input

```ts
type In = {
  type: string;
  field: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "field": "phone",
    "type": "contact"
  },
  "output": {
    "ok": true
  }
}
```
