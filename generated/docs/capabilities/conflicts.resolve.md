# conflicts.resolve

Resolve a conflict with a choice and a summary; applies the value as the person and writes an Undo op

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
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/conflicts/resolve |
| MCP tool | conflicts_resolve (meta) |
| CLI | none |
| Emits | conflict.resolved |

## Input

```ts
type In = {
  conflictId: string;
  choice: "ours" | "theirs" | "merged" | "custom";
  value?: unknown;
  summary: string;
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
- permission.on_hold
- validation.bad_input
- validation.field_locked
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "choice": "ours",
    "conflictId": "cfl_a1b2c3",
    "summary": "example",
    "value": {}
  },
  "output": {
    "resolutionId": "res_a1b2c3",
    "state": "open"
  }
}
```
