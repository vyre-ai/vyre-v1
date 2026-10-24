# bookings.cancel

Cancel a booking

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
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/bookings/cancel |
| MCP tool | bookings_cancel (automations) |
| CLI | none |
| Emits | booking.cancelled |

## Input

```ts
type In = {
  bookingId: string;
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
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "bookingId": "bkg_a1b2c3"
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
