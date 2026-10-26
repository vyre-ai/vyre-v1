# records.purge_trashed

Hard-delete records that have been in Trash since before a time (retention)

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
| HTTP | POST /v1/records/purge_trashed |
| MCP tool | none |
| CLI | none |
| Emits | records.trash_purged |

## Input

```ts
type In = {
  before: number;
  limit?: number;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  removed: number;
  more: boolean;
  skippedOnHold?: number;
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
    "before": 1760000000000,
    "idempotencyKey": "idem_1",
    "limit": 1
  },
  "output": {
    "more": true,
    "removed": 1,
    "skippedOnHold": 1
  }
}
```
