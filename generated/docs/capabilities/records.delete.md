# records.delete

Move a record to Trash

| | |
|---|---|
| Module | records |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | records.delete |
| Grant level | edit |
| Risk | medium |
| Resource | record (/recordId) |
| Gate | delete when actor.kind != 'person' |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/records/delete |
| MCP tool | records_delete (records) |
| CLI | none |
| Emits | record.deleted |

## Input

```ts
type In = {
  type: string;
  recordId: string;
};
```

## Output

```ts
type Out = {
  deleted: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.on_hold
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "recordId": "rec_a1b2c3",
    "type": "contact"
  },
  "output": {
    "deleted": true
  }
}
```
