# mail.draft

Create or update a draft (an agent draft waits for Send, Edit or Discard with a Gate line)

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | mailbox (/mailboxId) |
| Gate | none |
| Idempotency | key |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mail/draft |
| MCP tool | mail_draft (inbox) |
| CLI | none |
| Emits | mail_draft.saved |

## Input

```ts
type In = {
  mailboxId: string;
  to?: Array<{
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
  subject?: string;
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
  draftId: string;
  gateLine?: string;
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
    "draftId": "eml_a1b2c3",
    "gateLine": "example"
  }
}
```
