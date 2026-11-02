# mail.send_preview

Dry run of a send: who would be reached and who is suppressed, without sending

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | use |
| Risk | low |
| Resource | mailbox (/mailboxId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mail/send_preview |
| MCP tool | mail_send_preview (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  mailboxId: string;
  senderId?: string;
  channel?: "email";
  to: Array<{
      address: string;
      name?: string;
      contactId?: string;
    }>;
};
```

## Output

```ts
type Out = {
  allowed: Array<string>;
  suppressed: Array<{
      address: string;
      reason: string;
    }>;
  providerRoute: "mailbox" | "space_domain";
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
    "channel": "email",
    "mailboxId": "mbx_a1b2c3",
    "senderId": "mbx_a1b2c3",
    "to": [
      {
        "address": "maya@example.com",
        "contactId": "rec_a1b2c3",
        "name": "example"
      }
    ]
  },
  "output": {
    "allowed": [
      "maya@example.com"
    ],
    "providerRoute": "mailbox",
    "suppressed": [
      {
        "address": "maya@example.com",
        "reason": "example"
      }
    ]
  }
}
```
