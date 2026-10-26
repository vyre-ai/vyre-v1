# bookings.book

Public: make a booking; creates or updates a record and a meeting

| | |
|---|---|
| Module | forms |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /book/create |
| MCP tool | none |
| CLI | none |
| Emits | booking.created |

## Input

```ts
type In = {
  slug: string;
  startsAt: number;
  answers: Record<string, unknown>;
  tz: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  booking: {
    bookingId: string;
    formId: string;
    recordId: string;
    startsAt: number;
    endsAt: number;
    hostId: string;
    state: "booked" | "cancelled" | "rescheduled";
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "answers": {},
    "idempotencyKey": "idem_1",
    "slug": "intake",
    "startsAt": 1760000000000,
    "tz": "example"
  },
  "output": {
    "booking": {
      "bookingId": "bkg_a1b2c3",
      "endsAt": 1760000000000,
      "formId": "frm_a1b2c3",
      "hostId": "usr_a1b2c3",
      "recordId": "rec_a1b2c3",
      "startsAt": 1760000000000,
      "state": "booked"
    }
  }
}
```
