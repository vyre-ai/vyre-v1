# records.reveal

Reveal a sealed field to the caller (asked once, logged per actor)

| | |
|---|---|
| Module | records |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | records.reveal |
| Grant level | view |
| Risk | high |
| Resource | record (/recordId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/records/reveal |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: string;
  recordId: string;
  field: string;
};
```

## Output

```ts
type Out = {
  value: unknown;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.provider_label
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "field": "example",
    "recordId": "rec_a1b2c3",
    "type": "contact"
  },
  "output": {
    "value": {}
  }
}
```
