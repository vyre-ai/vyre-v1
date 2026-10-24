# bookings.availability

Open slots in the visitor time zone from connected calendars; unavailable when the host is disconnected

| | |
|---|---|
| Module | forms |
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
| Team Space only | yes |
| HTTP | GET /book/availability |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  slug: string;
  tz: string;
  from: number;
  to: number;
};
```

## Output

```ts
type Out = {
  slots: Array<{
      startsAt: number;
      endsAt: number;
      hostId: string;
    }>;
  available: boolean;
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
    "from": 1760000000000,
    "slug": "intake",
    "to": 1760000000000,
    "tz": "America/Los_Angeles"
  },
  "output": {
    "available": true,
    "slots": [
      {
        "endsAt": 1760000000000,
        "hostId": "usr_a1b2c3",
        "startsAt": 1760000000000
      }
    ]
  }
}
```
