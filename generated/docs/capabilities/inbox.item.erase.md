# inbox.item.erase

Erase the conversation entries of one message, text or call for good: previews, subjects and participants go, the conversation keeps only what other items still say (governance erase)

| | |
|---|---|
| Module | inbox |
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
| HTTP | POST /v1/inbox/item/erase |
| MCP tool | none |
| CLI | none |
| Emits | inbox.item_erased |

## Input

```ts
type In = {
  refId: string;
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
    "refId": "sms_a1b2c3"
  },
  "output": {
    "erased": true
  }
}
```
