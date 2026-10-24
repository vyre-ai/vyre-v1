# mail.message.list

List messages of a mailbox, thread or contact

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
| HTTP | POST /v1/mail/message/list |
| MCP tool | mail_message_list (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  mailboxId?: string;
  threadId?: string;
  contactId?: string;
  status?: "draft" | "queued" | "sent" | "delivered" | "bounced" | "complained" | "failed" | "received";
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  messages: Array<{
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
    }>;
  next?: string;
  total?: number;
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
    "contactId": "rec_a1b2c3",
    "cursor": "example",
    "limit": 1,
    "mailboxId": "mbx_a1b2c3",
    "status": "draft",
    "threadId": "example"
  },
  "output": {
    "messages": [
      {
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
    ],
    "next": "example",
    "total": 1
  }
}
```
