# calendar.availability

Busy blocks for people over a range (the shaded stripes while adding people)

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
| HTTP | POST /v1/calendar/availability |
| MCP tool | calendar_availability (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  people: Array<string>;
  from: number;
  to: number;
};
```

## Output

```ts
type Out = {
  busy: Array<{
      who: string;
      startsAt: number;
      endsAt: number;
    }>;
  unknown: Array<string>;
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
    "from": 1760000000000,
    "people": [
      "example"
    ],
    "to": 1760000000000
  },
  "output": {
    "busy": [
      {
        "endsAt": 1760000000000,
        "startsAt": 1760000000000,
        "who": "example"
      }
    ],
    "unknown": [
      "example"
    ]
  }
}
```
