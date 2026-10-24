# calendar.find_time

Find a time: the next free slots for a set of people

| | |
|---|---|
| Module | calendar |
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
| Team Space only | no |
| HTTP | POST /v1/calendar/find_time |
| MCP tool | calendar_find_time (inbox) |
| CLI | vyre calendar find-time |
| Emits | none |

## Input

```ts
type In = {
  people: Array<string>;
  durationMinutes: number;
  from: number;
  to: number;
  workingHoursOnly?: boolean;
  limit?: number;
};
```

## Output

```ts
type Out = {
  slots: Array<{
      startsAt: number;
      endsAt: number;
    }>;
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
    "durationMinutes": 5,
    "from": 1760000000000,
    "limit": 1,
    "people": [
      "example"
    ],
    "to": 1760000000000,
    "workingHoursOnly": true
  },
  "output": {
    "slots": [
      {
        "endsAt": 1760000000000,
        "startsAt": 1760000000000
      }
    ]
  }
}
```
