# conflicts.undo

Undo a resolution: re-applies the previous value as a normal op

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
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/conflicts/undo |
| MCP tool | conflicts_undo (meta) |
| CLI | none |
| Emits | conflict.undone |

## Input

```ts
type In = {
  resolutionId: string;
};
```

## Output

```ts
type Out = {
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
    "resolutionId": "res_a1b2c3"
  },
  "output": {
    "state": "open"
  }
}
```
