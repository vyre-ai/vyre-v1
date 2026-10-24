# conflicts.confirm

Confirm the assistant proposal on a protected field (the Answer task action in Needs you)

| | |
|---|---|
| Module | conflicts |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/conflicts/confirm |
| MCP tool | conflicts_confirm (meta) |
| CLI | none |
| Emits | conflict.resolved |

## Input

```ts
type In = {
  conflictId: string;
};
```

## Output

```ts
type Out = {
  resolutionId: string;
  state: "open" | "proposed" | "needs_you" | "resolved" | "undone";
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "conflictId": "cfl_a1b2c3"
  },
  "output": {
    "resolutionId": "res_a1b2c3",
    "state": "open"
  }
}
```
