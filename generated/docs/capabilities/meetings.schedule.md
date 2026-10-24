# meetings.schedule

Schedule a meeting: calendar event, provider link and Meeting record in one step

| | |
|---|---|
| Module | meetings |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | records.create |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | send when actor.kind != 'person' |
| Idempotency | key |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/meetings/schedule |
| MCP tool | meetings_schedule (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  title: string;
  startsAt: number;
  endsAt: number;
  attendees: Array<{
      email: string;
      name?: string;
      contactId?: string;
    }>;
  provider: "zoom" | "meet" | "teams" | "none";
  calendarId?: string;
  agenda?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  meetingId: string;
  eventId: string;
  joinUrl?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "agenda": "example",
    "attendees": [
      {
        "contactId": "rec_a1b2c3",
        "email": "maya@example.com",
        "name": "example"
      }
    ],
    "calendarId": "cld_a1b2c3",
    "endsAt": 1760000000000,
    "idempotencyKey": "idem_1",
    "provider": "zoom",
    "startsAt": 1760000000000,
    "title": "example"
  },
  "output": {
    "eventId": "cev_a1b2c3",
    "joinUrl": "example",
    "meetingId": "rec_a1b2c3"
  }
}
```
