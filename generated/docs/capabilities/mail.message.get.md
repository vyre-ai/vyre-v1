# mail.message.get

Read one message with attachments, provider id, DNS check state and trace id

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
| HTTP | POST /v1/mail/message/get |
| MCP tool | mail_message_get (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  messageId: string;
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
  text?: string;
  html?: string;
  attachments: Array<{
      attachmentId: string;
      name: string;
      mime: string;
      size: number;
      fileId?: string;
    }>;
  provider: {
    providerId?: string;
    dns?: {
      spf: "pass" | "fail" | "pending";
      dkim: "pass" | "fail" | "pending";
      dmarc: "pass" | "fail" | "pending";
    };
    traceId: string;
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
    "messageId": "eml_a1b2c3"
  },
  "output": {
    "attachments": [
      {
        "attachmentId": "example",
        "fileId": "fil_a1b2c3",
        "mime": "example",
        "name": "example",
        "size": 1
      }
    ],
    "html": "example",
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
    },
    "provider": {
      "dns": {
        "dkim": "pass",
        "dmarc": "pass",
        "spf": "pass"
      },
      "providerId": "example",
      "traceId": "0123456789abcdef0123456789abcdef"
    },
    "text": "example"
  }
}
```
