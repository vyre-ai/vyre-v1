# calendar.move_to_calendar

Move an event to another calendar

| | |
|---|---|
| Module | calendar |
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
| HTTP | POST /v1/calendar/move_to_calendar |
| MCP tool | calendar_move_to_calendar (inbox) |
| CLI | none |
| Emits | calendar_event.updated |

## Input

```ts
type In = {
  eventId: string;
  calendarId: string;
};
```

## Output

```ts
type Out = {
  event: {
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
  };
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
    "calendarId": "cld_a1b2c3",
    "eventId": "cev_a1b2c3"
  },
  "output": {
    "event": {
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
  }
}
```
