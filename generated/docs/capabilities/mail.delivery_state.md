# mail.delivery_state

A message's delivery trail (messageId), else inbox health

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mail/delivery_state |
| MCP tool | mail_delivery_state (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  messageId?: string;
  mailboxId?: string;
};
```

## Output

```ts
type Out = {
  result: unknown;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "mailboxId": "mbx_a1b2c3",
    "messageId": "eml_a1b2c3"
  },
  "output": {
    "result": {}
  }
}
```
