# calendar.link_record

Link an event to records, or remove a link (Open Record, Open Conversation)

| | |
|---|---|
| Module | calendar |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | entity (/eventId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/calendar/link_record |
| MCP tool | calendar_link_record (inbox) |
| CLI | none |
| Emits | calendar_event.updated |

## Input

```ts
type In = {
  eventId: string;
  recordIds: Array<string>;
  unlink?: boolean;
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
    "eventId": "cev_a1b2c3",
    "recordIds": [
      "rec_a1b2c3"
    ],
    "unlink": true
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
