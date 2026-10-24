# calendar.create_event

Create an event (drag in 15 minute steps); the provider invites attendees

| | |
|---|---|
| Module | calendar |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | calendar (/calendarId) |
| Gate | send when actor.kind != 'person' && input.attendees != null |
| Idempotency | key |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/calendar/create_event |
| MCP tool | calendar_create_event (inbox) |
| CLI | vyre calendar create |
| Emits | calendar_event.created |

## Input

```ts
type In = {
  calendarId: string;
  title: string;
  startsAt: number;
  endsAt: number;
  allDay?: boolean;
  location?: string;
  description?: string;
  agenda?: string;
  attendees?: Array<{
      email: string;
      name?: string;
      contactId?: string;
      optional?: boolean;
      response?: "needs_action" | "accepted" | "declined" | "tentative";
    }>;
  recordIds?: Array<string>;
  joinProvider?: "zoom" | "meet" | "teams" | "none";
  bookedByAgentId?: string;
  fromBookingPage?: string;
  idempotencyKey: string;
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
    "idempotencyKey": "idem_1",
    "joinProvider": "zoom",
    "location": "example",
    "recordIds": [
      "rec_a1b2c3"
    ],
    "startsAt": 1760000000000,
    "title": "example"
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
