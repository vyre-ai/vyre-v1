# meetings.closeout.propose

The Assistant's close-out of a meeting: summary, decisions, open questions, action items, record updates, the follow-up email and the next meeting

| | |
|---|---|
| Module | meetings |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | record (/meetingId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/meetings/closeout/propose |
| MCP tool | meetings_closeout_propose (inbox) |
| CLI | none |
| Emits | meeting.closeout_ready, meeting.summary_ready |

## Input

```ts
type In = {
  meetingId: string;
  summary: string;
  decisions?: Array<string>;
  questions?: Array<string>;
  actions?: Array<{
      title: string;
      owner?: string;
      due?: string;
      why?: string;
    }>;
  records?: Array<{
      recordId: string;
      changes?: Array<{
          field: string;
          value: string;
        }>;
      note?: string;
    }>;
  email?: {
    subject: string;
    text: string;
  };
  next?: {
    title?: string;
    startsAt: string;
    minutes?: number;
  };
};
```

## Output

```ts
type Out = {
  meetingId: string;
  state: "preparing" | "ready" | "closed" | "nothing";
  items: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "actions": [
      {
        "due": "example",
        "owner": "example",
        "title": "example",
        "why": "example"
      }
    ],
    "decisions": [
      "example"
    ],
    "email": {
      "subject": "example",
      "text": "example"
    },
    "meetingId": "rec_a1b2c3",
    "next": {
      "minutes": 5,
      "startsAt": "example",
      "title": "example"
    },
    "questions": [
      "example"
    ],
    "records": [
      {
        "changes": [
          {
            "field": "example",
            "value": "example"
          }
        ],
        "note": "example",
        "recordId": "rec_a1b2c3"
      }
    ],
    "summary": "example"
  },
  "output": {
    "items": 1,
    "meetingId": "rec_a1b2c3",
    "state": "preparing"
  }
}
```
