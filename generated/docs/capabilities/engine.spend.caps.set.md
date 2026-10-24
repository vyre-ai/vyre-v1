# engine.spend.caps.set

Set spend and usage caps for the Space, a person or an agent; agent.toml can never exceed them

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | ai.spend |
| Grant level | manage |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/engine/spend/caps/set |
| MCP tool | engine_spend_caps_set (meta) |
| CLI | none |
| Emits | spend.caps_changed |

## Input

```ts
type In = {
  scope: "space" | "person" | "agent";
  scopeId?: string;
  caps: {
    run?: number;
    dayMicros?: number;
    monthMicros?: number;
    turnsPerDay?: number;
    timeMinutesPerRun?: number;
  };
};
```

## Output

```ts
type Out = {
  caps: {
    run?: number;
    dayMicros?: number;
    monthMicros?: number;
    turnsPerDay?: number;
    timeMinutesPerRun?: number;
  };
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
    "caps": {
      "dayMicros": 1,
      "monthMicros": 1,
      "run": 1,
      "timeMinutesPerRun": 1,
      "turnsPerDay": 1
    },
    "scope": "space",
    "scopeId": "example"
  },
  "output": {
    "caps": {
      "dayMicros": 1,
      "monthMicros": 1,
      "run": 1,
      "timeMinutesPerRun": 1,
      "turnsPerDay": 1
    }
  }
}
```
