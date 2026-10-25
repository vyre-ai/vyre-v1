# inbox.thread

The whole history of one contact: emails, texts, calls, meetings, campaign lines and record chips

| | |
|---|---|
| Module | inbox |
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
| HTTP | POST /v1/inbox/thread |
| MCP tool | inbox_thread (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  conversationId?: string;
  contactId?: string;
  before?: number;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  conversation: {
    id: string;
    contactId?: string;
    address: string;
    displayName: string;
    lastMessageAt: number;
    lastChannel: "email" | "sms" | "call" | "meeting";
    lastPreview: string;
    unreadCount: number;
    needsMatch: boolean;
    ownerId?: string;
    mailboxIds: Array<string>;
    campaignId?: string;
    followed: boolean;
    alertOnReplies: boolean;
    starred?: boolean;
  };
  items: Array<{
      kind: "email" | "sms" | "call" | "meeting" | "campaign_step" | "record_chip" | "note";
      id: string;
      at: number;
      direction?: "in" | "out";
      title?: string;
      preview?: string;
      campaignId?: string;
      recordId?: string;
      ref?: unknown;
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
    "before": 1760000000000,
    "contactId": "rec_a1b2c3",
    "conversationId": "cnv_a1b2c3",
    "cursor": "example",
    "limit": 1
  },
  "output": {
    "conversation": {
      "address": "maya@example.com",
      "alertOnReplies": true,
      "campaignId": "cmp_a1b2c3",
      "contactId": "rec_a1b2c3",
      "displayName": "example",
      "followed": true,
      "id": "cnv_a1b2c3",
      "lastChannel": "email",
      "lastMessageAt": 1760000000000,
      "lastPreview": "example",
      "mailboxIds": [
        "mbx_a1b2c3"
      ],
      "needsMatch": true,
      "ownerId": "usr_a1b2c3",
      "starred": true,
      "unreadCount": 1
    },
    "items": [
      {
        "at": 1760000000000,
        "campaignId": "cmp_a1b2c3",
        "direction": "in",
        "id": "example",
        "kind": "email",
        "preview": "example",
        "recordId": "rec_a1b2c3",
        "ref": {},
        "title": "example"
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
