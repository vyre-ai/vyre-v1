# conflicts.assist

Start the assistant run that compares both sides of a non-restricted conflict (never started for Restricted fields)

| | |
|---|---|
| Module | conflicts |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/conflicts/assist |
| MCP tool | none |
| CLI | none |
| Emits | conflict.proposed, conflict.confirmation_needed, conflict.resolved |

## Input

```ts
type In = {
  conflictId: string;
};
```

## Output

```ts
type Out = {
  runId: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.provider_label
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "conflictId": "cfl_a1b2c3"
  },
  "output": {
    "runId": "run_a1b2c3"
  }
}
```
