# mail.mailbox.disconnect

Remove a mailbox connection (mail already filed to records stays)

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | medium |
| Resource | mailbox (/mailboxId) |
| Gate | delete when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mail/mailbox/disconnect |
| MCP tool | mail_mailbox_disconnect (inbox) |
| CLI | none |
| Emits | mailbox.disconnected |

## Input

```ts
type In = {
  mailboxId: string;
};
```

## Output

```ts
type Out = {
  disconnected: boolean;
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
    "mailboxId": "mbx_a1b2c3"
  },
  "output": {
    "disconnected": true
  }
}
```
