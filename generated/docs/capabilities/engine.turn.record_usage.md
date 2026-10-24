# engine.turn.record_usage

Meter usage during a turn; over an agent.toml or Space limit it stops the turn and raises agent.limit_hit

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/turn/record_usage |
| MCP tool | none |
| CLI | none |
| Emits | agent.limit_hit |

## Input

```ts
type In = {
  turnId: string;
  tokensIn: number;
  tokensOut: number;
  costMicros: number;
};
```

## Output

```ts
type Out = {
  overLimit?: "run" | "day" | "month" | "turns" | "time";
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
    "costMicros": 1,
    "tokensIn": 1,
    "tokensOut": 1,
    "turnId": "trn_a1b2c3"
  },
  "output": {
    "overLimit": "run"
  }
}
```
