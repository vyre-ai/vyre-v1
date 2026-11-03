# goals.go

System: may the work of a goal wake its agents now (false while it is a draft, paused or ended)

| | |
|---|---|
| Module | goals |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/goals/go |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  goalId: string;
};
```

## Output

```ts
type Out = {
  go: boolean;
  status?: "draft" | "planning" | "active" | "waiting" | "stuck" | "paused" | "done" | "missed" | "stopped";
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
    "goalId": "gol_a1b2c3"
  },
  "output": {
    "go": true,
    "status": "draft"
  }
}
```
