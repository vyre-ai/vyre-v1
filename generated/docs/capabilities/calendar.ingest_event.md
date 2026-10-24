# calendar.ingest_event

Land one provider event: upsert by provider id, then merge with a meeting on time plus attendees or on link

| | |
|---|---|
| Module | calendar |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | calendar (/calendarId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/calendar/ingest_event |
| MCP tool | none |
| CLI | none |
| Emits | calendar_event.created, calendar_event.updated, calendar_event.deleted |

## Input

```ts
type In = {
  source: "google" | "microsoft";
  calendarId: string;
  providerId: string;
  deleted?: boolean;
  title?: string;
  startsAt?: number;
  endsAt?: number;
  allDay?: boolean;
  location?: string;
  joinUrl?: string;
  organizer?: string;
  attendees?: Array<{
      email: string;
      name?: string;
      contactId?: string;
      optional?: boolean;
      response?: "needs_action" | "accepted" | "declined" | "tentative";
    }>;
  description?: string;
};
```

## Output

```ts
type Out = {
  eventId: string;
  meetingId?: string;
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
    "calendarId": "cld_a1b2c3",
    "deleted": true,
    "description": "example",
    "endsAt": 1760000000000,
    "joinUrl": "example",
    "location": "example",
    "organizer": "maya@example.com",
    "providerId": "example",
    "source": "google",
    "startsAt": 1760000000000,
    "title": "example"
  },
  "output": {
    "eventId": "cev_a1b2c3",
    "meetingId": "rec_a1b2c3",
    "merged": true
  }
}
```
