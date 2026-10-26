# records.purge

Hard-delete one record for good: its fields, history, search entries and Trash row (governance erase; not Trash)

| | |
|---|---|
| Module | records |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | policy.manage |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/records/purge |
| MCP tool | none |
| CLI | none |
| Emits | record.purged |

## Input

```ts
type In = {
  type: string;
  recordId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  erased: boolean;
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
    "idempotencyKey": "idem_1",
    "recordId": "rec_a1b2c3",
    "type": "contact"
  },
  "output": {
    "erased": true
  }
}
```
