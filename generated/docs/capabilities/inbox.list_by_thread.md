# inbox.list_by_thread

Inbox thread view: one row per email thread or text thread

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
| HTTP | POST /v1/inbox/list_by_thread |
| MCP tool | inbox_list_by_thread (inbox) |
| CLI | none |
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
  threads: Array<{
      threadId: string;
      channel: "email" | "sms" | "call";
      subject?: string;
      mailboxId?: string;
      lastAt: number;
      participants: Array<string>;
      unread: number;
      contactId?: string;
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
    "showing": "example",
    "threads": [
      {
        "channel": "email",
        "contactId": "rec_a1b2c3",
        "lastAt": 1760000000000,
        "mailboxId": "mbx_a1b2c3",
        "participants": [
          "example"
        ],
        "subject": "example",
        "threadId": "example",
        "unread": 1
      }
    ],
    "total": 1
  }
}
```
