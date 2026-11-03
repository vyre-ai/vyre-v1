# meetings.closeout.skip

Skip a proposed close-out item, or bring a skipped one back

| | |
|---|---|
| Module | meetings |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | records.edit |
| Grant level | edit |
| Risk | medium |
| Resource | record (/meetingId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/meetings/closeout/skip |
| MCP tool | meetings_closeout_skip (inbox) |
| CLI | none |
| Emits | meeting.closed |

## Input

```ts
type In = {
  meetingId: string;
  itemId: string;
  undo?: boolean;
};
```

## Output

```ts
type Out = {
  item: {
    itemId: string;
    kind: "task" | "record" | "email" | "hold";
    status: "proposed" | "approved" | "skipped" | "failed";
    title: string;
    assignee?: string;
    ownerName?: string;
    due?: number;
    why?: string;
    recordId?: string;
    recordType?: string;
    changes?: Array<{
        field: string;
        title: string;
        from?: string;
        to: string;
      }>;
    note?: string;
    to?: Array<{
        address: string;
        name?: string;
      }>;
    subject?: string;
    text?: string;
    mailboxId?: string;
    send?: "send" | "draft";
    startsAt?: number;
    endsAt?: number;
    made?: Array<{
        type: "task" | "record" | "comment" | "email" | "draft" | "event" | "approval";
        id: string;
        title?: string;
      }>;
    error?: string;
  };
  state: "preparing" | "ready" | "closed" | "nothing";
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "itemId": "example",
    "meetingId": "rec_a1b2c3",
    "undo": true
  },
  "output": {
    "item": {
      "assignee": "usr_a1b2c3",
      "changes": [
        {
          "field": "example",
          "from": "example",
          "title": "example",
          "to": "example"
        }
      ],
      "due": 1760000000000,
      "endsAt": 1760000000000,
      "error": "example",
      "itemId": "mci_a1b2c3",
      "kind": "task",
      "made": [
        {
          "id": "example",
          "title": "example",
          "type": "task"
        }
      ],
      "mailboxId": "mbx_a1b2c3",
      "note": "example",
      "ownerName": "example",
      "recordId": "rec_a1b2c3",
      "recordType": "example",
      "send": "send",
      "startsAt": 1760000000000,
      "status": "proposed",
      "subject": "example",
      "text": "example",
      "title": "example",
      "to": [
        {
          "address": "maya@example.com",
          "name": "example"
        }
      ],
      "why": "example"
    },
    "state": "preparing"
  }
}
```
