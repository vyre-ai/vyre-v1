# mail.send

Send an email through the single send API: caps per sender, send windows, throttling, suppression, consent, trace id header, agent footer line

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | mailbox (/mailboxId) |
| Gate | send |
| Idempotency | key |
| Offline | queue |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mail/send |
| MCP tool | mail_send (inbox) |
| CLI | vyre mail send |
| Emits | message.sent, message.suppressed, message.failed |

## Input

```ts
type In = {
  mailboxId: string;
  route?: "mailbox" | "space_domain";
  to: Array<{
      address: string;
      name?: string;
      contactId?: string;
    }>;
  cc?: Array<{
      address: string;
      name?: string;
      contactId?: string;
    }>;
  bcc?: Array<{
      address: string;
      name?: string;
      contactId?: string;
    }>;
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<string>;
  replyToMessageId?: string;
  contactId?: string;
  campaignId?: string;
  draftId?: string;
  sendAt?: number;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  messageId?: string;
  status: "queued" | "sent" | "held" | "suppressed";
  taskId?: string;
  suppressed: Array<string>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_approval
- permission.no_grant
- provider.auth_failed
- provider.network
- provider.rate_limited
- provider.unavailable
- rate_limit.exceeded
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "mailboxId": "mbx_a1b2c3",
    "to": [
      {
        "address": "maya@example.com"
      }
    ],
    "subject": "Hello",
    "text": "Hi Maya"
  },
  "output": {
    "messageId": "eml_a1b2c3",
    "status": "queued",
    "suppressed": []
  }
}
```
