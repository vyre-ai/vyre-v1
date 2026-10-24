# engine.spend.raise

Raise a limit once or for good (the Needs you card "Raise once or Stop"); an agent asking passes the Gate

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | ai.spend |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | spend_raise when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/engine/spend/raise |
| MCP tool | engine_spend_raise (meta) |
| CLI | none |
| Emits | spend.raised |

## Input

```ts
type In = {
  scope: "space" | "person" | "agent";
  scopeId?: string;
  limit: "run" | "day" | "month" | "turns" | "time";
  mode: "once" | "permanent";
  amountMicros?: number;
};
```

## Output

```ts
type Out = {
  raised: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "amountMicros": 1,
    "limit": "run",
    "mode": "once",
    "scope": "space",
    "scopeId": "example"
  },
  "output": {
    "raised": true
  }
}
```
