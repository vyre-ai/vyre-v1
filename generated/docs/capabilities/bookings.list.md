# bookings.list

List bookings of a page

| | |
|---|---|
| Module | forms |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | form (/formId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/bookings/list |
| MCP tool | bookings_list (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  formId: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  bookings: Array<{
      bookingId: string;
      formId: string;
      recordId: string;
      startsAt: number;
      endsAt: number;
      hostId: string;
      state: "booked" | "cancelled" | "rescheduled";
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
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "cursor": "example",
    "formId": "frm_a1b2c3",
    "limit": 1
  },
  "output": {
    "bookings": [
      {
        "bookingId": "bkg_a1b2c3",
        "endsAt": 1760000000000,
        "formId": "frm_a1b2c3",
        "hostId": "usr_a1b2c3",
        "recordId": "rec_a1b2c3",
        "startsAt": 1760000000000,
        "state": "booked"
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
