# engine.spend.get

Spend against caps for the Space, a person or an agent (today, this month, pause state)

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/spend/get |
| MCP tool | engine_spend_get (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  scope: "space" | "person" | "agent";
  scopeId?: string;
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
  todayMicros: number;
  monthMicros: number;
  turnsToday: number;
  paused: boolean;
  pausedBy?: string;
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
    },
    "monthMicros": 1,
    "paused": true,
    "pausedBy": "example",
    "todayMicros": 1,
    "turnsToday": 1
  }
}
```
