# records.hold

Place a hold on a record

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
| HTTP | POST /v1/records/hold |
| MCP tool | none |
| CLI | none |
| Emits | record.held |

## Input

```ts
type In = {
  type: string;
  recordId: string;
  reason: string;
};
```

## Output

```ts
type Out = {
  held: boolean;
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
    "reason": "example",
    "recordId": "rec_a1b2c3",
    "type": "contact"
  },
  "output": {
    "held": true
  }
}
```
