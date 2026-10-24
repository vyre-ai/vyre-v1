# mail.send_as

Send through a member's own Gmail, Graph or IMAP mailbox (replies go out from the inbox the thread came in on)

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
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mail/send_as |
| MCP tool | none |
| CLI | none |
| Emits | message.sent, message.failed |

## Input

```ts
type In = {
  mailboxId: string;
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
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  messageId: string;
  providerId?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.auth_failed
- provider.network
- provider.rate_limited
- provider.unavailable
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "attachments": [
      "fil_a1b2c3"
    ],
    "bcc": [
      {
        "address": "maya@example.com",
        "contactId": "rec_a1b2c3",
        "name": "example"
      }
    ],
    "campaignId": "cmp_a1b2c3",
    "cc": [
      {
        "address": "maya@example.com",
        "contactId": "rec_a1b2c3",
        "name": "example"
      }
    ],
    "contactId": "rec_a1b2c3",
    "draftId": "eml_a1b2c3",
    "html": "example",
    "idempotencyKey": "idem_1",
    "mailboxId": "mbx_a1b2c3",
    "replyToMessageId": "eml_a1b2c3",
    "subject": "example",
    "text": "example",
    "to": [
      {
        "address": "maya@example.com",
        "contactId": "rec_a1b2c3",
        "name": "example"
      }
    ]
  },
  "output": {
    "messageId": "eml_a1b2c3",
    "providerId": "example"
  }
}
```
