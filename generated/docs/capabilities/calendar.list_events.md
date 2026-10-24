# calendar.list_events

Events in a time range for chosen calendars (Day, Week and Month views)

| | |
|---|---|
| Module | calendar |
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
| HTTP | POST /v1/calendar/list_events |
| MCP tool | calendar_list_events (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  from: number;
  to: number;
  calendarIds?: Array<string>;
  query?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  events: Array<{
      id: string;
      calendarId: string;
      title: string;
      startsAt: number;
      endsAt: number;
      allDay: boolean;
      location?: string;
      joinUrl?: string;
      joinProvider: "zoom" | "meet" | "teams" | "none";
      description?: string;
      agenda?: string;
      attendees: Array<{
          email: string;
          name?: string;
          contactId?: string;
          optional?: boolean;
          response?: "needs_action" | "accepted" | "declined" | "tentative";
        }>;
      organizer?: string;
      recordIds: Array<string>;
      meetingId?: string;
      status: "confirmed" | "tentative" | "canceled";
      bookedByAgentId?: string;
      fromBookingPage?: string;
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
    "calendarIds": [
      "cld_a1b2c3"
    ],
    "cursor": "example",
    "from": 1760000000000,
    "limit": 1,
    "query": "example",
    "to": 1760000000000
  },
  "output": {
    "events": [
      {
        "agenda": "example",
        "allDay": true,
        "attendees": [
          {
            "contactId": "rec_a1b2c3",
            "email": "maya@example.com",
            "name": "example",
            "optional": true,
            "response": "needs_action"
          }
        ],
        "bookedByAgentId": "agt_a1b2c3",
        "calendarId": "cld_a1b2c3",
        "description": "example",
        "endsAt": 1760000000000,
        "fromBookingPage": "frm_a1b2c3",
        "id": "cev_a1b2c3",
        "joinProvider": "zoom",
        "joinUrl": "example",
        "location": "example",
        "meetingId": "rec_a1b2c3",
        "organizer": "maya@example.com",
        "recordIds": [
          "rec_a1b2c3"
        ],
        "startsAt": 1760000000000,
        "status": "confirmed",
        "title": "example"
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
