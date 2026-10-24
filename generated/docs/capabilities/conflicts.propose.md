# conflicts.propose

Store the assistant proposal for a conflict; protected fields (status, money, owner, locked, sealed) go to Needs you for confirmation, others resolve

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
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/conflicts/propose |
| MCP tool | none |
| CLI | none |
| Emits | conflict.proposed, conflict.confirmation_needed, conflict.resolved |

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
  state: "open" | "proposed" | "needs_you" | "resolved" | "undone";
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
    "choice": "ours",
    "conflictId": "cfl_a1b2c3",
    "summary": "example",
    "value": {}
  },
  "output": {
    "state": "open"
  }
}
```
