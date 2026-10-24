# meetings.ingest

Land a calendar event or provider meeting: merge on time plus attendees or on link into one Meeting

| | |
|---|---|
| Module | meetings |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/meetings/ingest |
| MCP tool | none |
| CLI | none |
| Emits | meeting.merged |

## Input

```ts
type In = {
  source: "calendar" | "zoom" | "meet" | "teams";
  providerRef: string;
  calendarEventId?: string;
  title?: string;
  startsAt: number;
  endsAt?: number;
  joinUrl?: string;
  attendees: Array<{
      email: string;
      name?: string;
      contactId?: string;
    }>;
  status?: "scheduled" | "live" | "ended" | "canceled";
};
```

## Output

```ts
type Out = {
  meetingId: string;
  created: boolean;
  merged: boolean;
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
    "attendees": [
      {
        "contactId": "rec_a1b2c3",
        "email": "maya@example.com",
        "name": "example"
      }
    ],
    "calendarEventId": "cev_a1b2c3",
    "endsAt": 1760000000000,
    "joinUrl": "example",
    "providerRef": "example",
    "source": "calendar",
    "startsAt": 1760000000000,
    "status": "scheduled",
    "title": "example"
  },
  "output": {
    "created": true,
    "meetingId": "rec_a1b2c3",
    "merged": true
  }
}
```
