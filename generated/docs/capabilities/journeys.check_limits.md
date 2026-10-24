# journeys.check_limits

Find stages over their time limit, raise Needs you for the owner then the escalation role (called by the scheduler)

| | |
|---|---|
| Module | journeys |
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
| HTTP | POST /v1/journeys/check_limits |
| MCP tool | none |
| CLI | none |
| Emits | journey.time_limit_breached |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  breached: number;
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
  "input": {},
  "output": {
    "breached": 1
  }
}
```
