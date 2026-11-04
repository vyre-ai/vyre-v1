# settings.public_of

A teammate's time zone, working hours and pronouns, only when they set them themselves

| | |
|---|---|
| Module | settings |
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
| HTTP | POST /v1/settings/public_of |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  personId: string;
};
```

## Output

```ts
type Out = {
  timezone?: string;
  hours?: {
    days: Array<number>;
    from: string;
    to: string;
  };
  pronouns?: string;
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
    "personId": "usr_a1b2c3"
  },
  "output": {
    "hours": {
      "days": [
        1
      ],
      "from": "example",
      "to": "example"
    },
    "pronouns": "example",
    "timezone": "example"
  }
}
```
