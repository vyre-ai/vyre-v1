# goals.wake_claim

System: the engine claims one wake-up of a goal before it starts the turn, so a wake-up read twice runs once. Only the server may call it

| | |
|---|---|
| Module | goals |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/goals/wake_claim |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  goalId: string;
  wakeId: string;
  attempt: number;
};
```

## Output

```ts
type Out = {
  claimed: boolean;
  threadId?: string;
  leadAgentId?: string;
  owner?: string;
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
    "attempt": 1,
    "goalId": "gol_a1b2c3",
    "wakeId": "example"
  },
  "output": {
    "claimed": true,
    "leadAgentId": "agt_a1b2c3",
    "owner": "usr_a1b2c3",
    "threadId": "thr_a1b2c3"
  }
}
```
