# goals.brief

What the lead agent of a goal reads at each wake-up: the finish line and where it stands, why it was woken, the plan, what waits, the budget and the rules

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
| HTTP | POST /v1/goals/brief |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  goalId: string;
  agentId?: string;
};
```

## Output

```ts
type Out = {
  text: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "goalId": "gol_a1b2c3"
  },
  "output": {
    "text": "example"
  }
}
```
