# schema.set_label

Set the sensitivity label of a record type or of one field

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
| HTTP | POST /v1/schema/set_label |
| MCP tool | schema_set_label (engineer) |
| CLI | none |
| Emits | schema.label_changed, schema.changed |

## Input

```ts
type In = {
  type: string;
  field?: string;
  label: "public" | "internal" | "confidential" | "restricted";
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
    "label": "public",
    "type": "contact"
  },
  "output": {
    "ok": true
  }
}
```
