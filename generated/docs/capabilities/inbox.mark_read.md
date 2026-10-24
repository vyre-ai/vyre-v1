# inbox.mark_read

Mark a conversation read or unread

| | |
|---|---|
| Module | inbox |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | entity (/conversationId) |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/inbox/mark_read |
| MCP tool | inbox_mark_read (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  conversationId: string;
  read?: boolean;
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
    "conversationId": "cnv_a1b2c3",
    "read": true
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
    }
  }
}
```
