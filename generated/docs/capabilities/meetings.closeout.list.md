# meetings.closeout.list

The Meetings tab of the Inbox: your meetings (and meetings shared to a project or channel you can read) with their close-out state

| | |
|---|---|
| Module | meetings |
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
| HTTP | POST /v1/meetings/closeout/list |
| MCP tool | meetings_closeout_list (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  state?: "preparing" | "ready" | "closed" | "nothing";
  recordId?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  meetings: Array<{
      meetingId: string;
      title: string;
      startsAt: number;
      endsAt?: number;
      attendees: Array<string>;
      state: "preparing" | "ready" | "closed" | "nothing";
      proposed: number;
      done: number;
    }>;
  ready: number;
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
    "limit": 1,
    "recordId": "rec_a1b2c3",
    "state": "preparing"
  },
  "output": {
    "meetings": [
      {
        "attendees": [
          "example"
        ],
        "done": 1,
        "endsAt": 1760000000000,
        "meetingId": "rec_a1b2c3",
        "proposed": 1,
        "startsAt": 1760000000000,
        "state": "preparing",
        "title": "example"
      }
    ],
    "next": "example",
    "ready": 1,
    "total": 1
  }
}
```
