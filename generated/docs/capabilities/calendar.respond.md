# calendar.respond

Accept, decline or answer maybe to an invitation

| | |
|---|---|
| Module | calendar |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | send when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/calendar/respond |
| MCP tool | calendar_respond (inbox) |
| CLI | none |
| Emits | calendar_event.response_changed |

## Input

```ts
type In = {
  eventId: string;
  response: "accepted" | "declined" | "tentative";
  comment?: string;
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
    "comment": "example",
    "eventId": "cev_a1b2c3",
    "response": "accepted"
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
