# mail.ingest

Land one inbound or synced message: dedupe on provider id, one record across inboxes, link to a contact (sure matches link, unsure go to Needs you)

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mail/ingest |
| MCP tool | none |
| CLI | none |
| Emits | mail.received |

## Input

```ts
type In = {
  source: "google" | "microsoft" | "imap" | "resend" | "mailgun";
  mailboxId?: string;
  envelopeTo?: string;
  providerId: string;
  rfcMessageId: string;
  threadKey?: string;
  direction?: "in" | "out";
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
  cc?: Array<{
      address: string;
      name?: string;
      contactId?: string;
    }>;
  subject: string;
  text?: string;
  html?: string;
  receivedAt: number;
  attachments?: Array<{
      name: string;
      mime: string;
      size: number;
      blobId: string;
    }>;
  headers?: Record<string, string>;
};
```

## Output

```ts
type Out = {
  messageId: string;
  deduped: boolean;
  linked: "sure" | "unsure" | "none";
  contactId?: string;
  conversationId?: string;
  taskId?: string;
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
    "attachments": [
      {
        "blobId": "blb_a1b2c3",
        "mime": "example",
        "name": "example",
        "size": 1
      }
    ],
    "cc": [
      {
        "address": "maya@example.com",
        "contactId": "rec_a1b2c3",
        "name": "example"
      }
    ],
    "direction": "in",
    "envelopeTo": "maya@example.com",
    "from": {
      "address": "maya@example.com",
      "contactId": "rec_a1b2c3",
      "name": "example"
    },
    "headers": {},
    "html": "example",
    "mailboxId": "mbx_a1b2c3",
    "providerId": "example",
    "receivedAt": 1760000000000,
    "rfcMessageId": "example",
    "source": "google",
    "subject": "example",
    "text": "example",
    "threadKey": "example",
    "to": [
      {
        "address": "maya@example.com",
        "contactId": "rec_a1b2c3",
        "name": "example"
      }
    ]
  },
  "output": {
    "contactId": "rec_a1b2c3",
    "conversationId": "cnv_a1b2c3",
    "deduped": true,
    "linked": "sure",
    "messageId": "eml_a1b2c3",
    "taskId": "tsk_a1b2c3"
  }
}
```
