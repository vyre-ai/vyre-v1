# inbox.match_new

Create a contact or company from an unmatched sender and match it

| | |
|---|---|
| Module | inbox |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | records.create |
| Grant level | edit |
| Risk | medium |
| Resource | entity (/conversationId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/inbox/match_new |
| MCP tool | inbox_match_new (inbox) |
| CLI | none |
| Emits | conversation.matched |

## Input

```ts
type In = {
  conversationId: string;
  type: "contact" | "company";
  name?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  recordId: string;
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
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "conversationId": "cnv_a1b2c3",
    "idempotencyKey": "idem_1",
    "name": "example",
    "type": "contact"
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
      "unreadCount": 1
    },
    "recordId": "rec_a1b2c3"
  }
}
```
