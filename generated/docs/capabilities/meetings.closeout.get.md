# meetings.closeout.get

One meeting close-out: summary, decisions, open questions and the proposed tasks, record updates, follow-up email and calendar hold

| | |
|---|---|
| Module | meetings |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | record (/meetingId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/meetings/closeout/get |
| MCP tool | meetings_closeout_get (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  meetingId: string;
};
```

## Output

```ts
type Out = {
  meetingId: string;
  title: string;
  startsAt: number;
  endsAt?: number;
  attendees: Array<{
      name: string;
      email?: string;
      recordId?: string;
    }>;
  state: "preparing" | "ready" | "closed" | "nothing";
  summary?: string;
  decisions: Array<string>;
  questions: Array<string>;
  items: Array<{
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
    }>;
  preparedAt?: number;
  taskId?: string;
  agentId?: string;
  shared: Array<{
      type: "project" | "channel";
      id: string;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "meetingId": "rec_a1b2c3"
  },
  "output": {
    "agentId": "agt_a1b2c3",
    "attendees": [
      {
        "email": "maya@example.com",
        "name": "example",
        "recordId": "rec_a1b2c3"
      }
    ],
    "decisions": [
      "example"
    ],
    "endsAt": 1760000000000,
    "items": [
      {
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
      }
    ],
    "meetingId": "rec_a1b2c3",
    "preparedAt": 1760000000000,
    "questions": [
      "example"
    ],
    "shared": [
      {
        "id": "example",
        "type": "project"
      }
    ],
    "startsAt": 1760000000000,
    "state": "preparing",
    "summary": "example",
    "taskId": "tsk_a1b2c3",
    "title": "example"
  }
}
```
