# engine.time_convert

Convert a time between time zones, or turn "tomorrow 2pm" into a time. Use it for any time not already in the person's zone; never work out zones, dates or epoch numbers yourself

| | |
|---|---|
| Module | engine |
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
| HTTP | POST /v1/engine/time_convert |
| MCP tool | time_convert (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  when: string;
  from?: string;
  to?: Array<string>;
  zone?: string;
};
```

## Output

```ts
type Out = {
  instant: string;
  given: string;
  zones?: Array<{
      zone: string;
      text: string;
    }>;
  inYourZone: string;
  personZone: string;
  note?: string;
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
    "from": "example",
    "to": [
      "example"
    ],
    "when": "example",
    "zone": "example"
  },
  "output": {
    "given": "example",
    "inYourZone": "example",
    "instant": "example",
    "note": "example",
    "personZone": "example",
    "zones": [
      {
        "text": "example",
        "zone": "example"
      }
    ]
  }
}
```
