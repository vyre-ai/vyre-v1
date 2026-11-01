# sync_types.restore_field

Put an earlier value of a field back (an ordinary edit, newer than the app's value, so it is sent on the next pass) and start that pass

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | records.edit |
| Grant level | edit |
| Risk | medium |
| Resource | record (/recordId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sync_types/restore_field |
| MCP tool | sync_types_restore_field (records) |
| CLI | none |
| Emits | record.updated |

## Input

```ts
type In = {
  type: string;
  recordId: string;
  field: string;
  historyId: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
  runId?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.field_locked
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "field": "email",
    "historyId": "example",
    "recordId": "rec_a1b2c3",
    "type": "contact"
  },
  "output": {
    "ok": true,
    "runId": "run_a1b2c3"
  }
}
```
