# inbox.needs_match

The Needs a match filter: unsure senders with suggested records

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
| HTTP | POST /v1/inbox/needs_match |
| MCP tool | inbox_needs_match (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  rows: Array<{
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
      suggestions: Array<{
          recordId: string;
          type: "contact" | "company";
          name: string;
          score: number;
          why: string;
        }>;
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
    "cursor": "example",
    "limit": 1
  },
  "output": {
    "next": "example",
    "rows": [
      {
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
        "suggestions": [
          {
            "name": "example",
            "recordId": "rec_a1b2c3",
            "score": 1,
            "type": "contact",
            "why": "example"
          }
        ]
      }
    ],
    "total": 1
  }
}
```
