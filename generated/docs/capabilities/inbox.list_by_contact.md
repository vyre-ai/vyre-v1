# inbox.list_by_contact

Inbox default view: one row per person, newest message across email, text and calls

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
| HTTP | POST /v1/inbox/list_by_contact |
| MCP tool | inbox_list_by_contact (inbox) |
| CLI | vyre inbox list |
| Emits | none |

## Input

```ts
type In = {
  mailboxId?: string;
  numberId?: string;
  channel?: "email" | "sms" | "call";
  needsMatch?: boolean;
  query?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  rows: Array<{
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
      organisation?: string;
      dnd?: boolean;
      bounced?: boolean;
      unmatched?: boolean;
      draftReady?: boolean;
    }>;
  showing: string;
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
    "channel": "email",
    "cursor": "example",
    "limit": 1,
    "mailboxId": "mbx_a1b2c3",
    "needsMatch": true,
    "numberId": "num_a1b2c3",
    "query": "example"
  },
  "output": {
    "next": "example",
    "rows": [
      {
        "address": "maya@example.com",
        "alertOnReplies": true,
        "bounced": true,
        "campaignId": "cmp_a1b2c3",
        "contactId": "rec_a1b2c3",
        "displayName": "example",
        "dnd": true,
        "draftReady": true,
        "followed": true,
        "id": "cnv_a1b2c3",
        "lastChannel": "email",
        "lastMessageAt": 1760000000000,
        "lastPreview": "example",
        "mailboxIds": [
          "mbx_a1b2c3"
        ],
        "needsMatch": true,
        "organisation": "Acme Legal",
        "ownerId": "usr_a1b2c3",
        "starred": true,
        "unmatched": true,
        "unreadCount": 1
      }
    ],
    "showing": "example",
    "total": 1
  }
}
```
