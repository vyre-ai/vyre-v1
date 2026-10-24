# records.release_hold

Release a hold on a record

| | |
|---|---|
| Module | records |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | records.hold |
| Grant level | edit |
| Risk | medium |
| Resource | record (/recordId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/records/release_hold |
| MCP tool | records_release_hold (records) |
| CLI | none |
| Emits | record.hold_released |

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
  released: boolean;
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
    "recordId": "rec_a1b2c3",
    "type": "contact"
  },
  "output": {
    "released": true
  }
}
```
