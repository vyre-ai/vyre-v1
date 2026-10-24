# mail.message.set_private

Mark a message private so it stays out of the record, or clear the mark (inbox owner only)

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | entity (/messageId) |
| Gate | none |
| Idempotency | natural |
| Offline | patch |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mail/message/set_private |
| MCP tool | mail_message_set_private (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  messageId: string;
  isPrivate: boolean;
};
```

## Output

```ts
type Out = {
  message: {
    id: string;
    mailboxId: string;
    inboxIds: Array<string>;
    threadId: string;
    direction: "in" | "out";
    status: "draft" | "queued" | "sent" | "delivered" | "bounced" | "complained" | "failed" | "received";
    from: {
      address: string;
      name?: string;
      contactId?: string;
    };
    to: Array<{
        address: string;
        name?: string;
        contactId?: string;
      }>;
    cc: Array<{
        address: string;
        name?: string;
        contactId?: string;
      }>;
    subject: string;
    snippet: string;
    sentAt: number;
    contactId?: string;
    isPrivate: boolean;
    campaignId?: string;
    draftedByAgent?: string;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "isPrivate": true,
    "messageId": "eml_a1b2c3"
  },
  "output": {
    "message": {
      "campaignId": "cmp_a1b2c3",
      "cc": [
        {
          "address": "maya@example.com",
          "contactId": "rec_a1b2c3",
          "name": "example"
        }
      ],
      "contactId": "rec_a1b2c3",
      "direction": "in",
      "draftedByAgent": "agt_a1b2c3",
      "from": {
        "address": "maya@example.com",
        "contactId": "rec_a1b2c3",
        "name": "example"
      },
      "id": "eml_a1b2c3",
      "inboxIds": [
        "mbx_a1b2c3"
      ],
      "isPrivate": true,
      "mailboxId": "mbx_a1b2c3",
      "sentAt": 1760000000000,
      "snippet": "example",
      "status": "draft",
      "subject": "example",
      "threadId": "example",
      "to": [
        {
          "address": "maya@example.com",
          "contactId": "rec_a1b2c3",
          "name": "example"
        }
      ]
    }
  }
}
```
