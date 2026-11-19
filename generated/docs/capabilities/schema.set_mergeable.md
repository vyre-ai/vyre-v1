# schema.set_mergeable

Switch "Can go in emails" on or off for one field: whether a template may merge its value into an email. Private and secret fields can never be switched on

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
| HTTP | POST /v1/schema/set_mergeable |
| MCP tool | schema_set_mergeable (engineer) |
| CLI | none |
| Emits | schema.changed |

## Input

```ts
type In = {
  type: string;
  field: string;
  mergeable: boolean;
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
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "field": "phone",
    "mergeable": true,
    "type": "contact"
  },
  "output": {
    "ok": true
  }
}
```
