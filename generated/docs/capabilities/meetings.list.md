# meetings.list

List meetings by time, contact or status

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
| HTTP | POST /v1/meetings/list |
| MCP tool | meetings_list (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  from?: number;
  to?: number;
  contactId?: string;
  status?: "scheduled" | "live" | "ended" | "canceled";
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  meetings: Array<{
      id: string;
      title: string;
      startsAt: number;
      endsAt?: number;
      provider: "zoom" | "meet" | "teams" | "none";
      joinUrl?: string;
      status: "scheduled" | "live" | "ended" | "canceled";
      organizer?: string;
      attendeeIds: Array<string>;
      calendarEventId?: string;
      recordingState: "none" | "pending" | "attached" | "unavailable";
      hasTranscript: boolean;
      hasSummary: boolean;
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
    "contactId": "rec_a1b2c3",
    "cursor": "example",
    "from": 1760000000000,
    "limit": 1,
    "status": "scheduled",
    "to": 1760000000000
  },
  "output": {
    "meetings": [
      {
        "attendeeIds": [
          "rec_a1b2c3"
        ],
        "calendarEventId": "cev_a1b2c3",
        "endsAt": 1760000000000,
        "hasSummary": true,
        "hasTranscript": true,
        "id": "rec_a1b2c3",
        "joinUrl": "example",
        "organizer": "usr_a1b2c3",
        "provider": "zoom",
        "recordingState": "none",
        "startsAt": 1760000000000,
        "status": "scheduled",
        "title": "example"
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
