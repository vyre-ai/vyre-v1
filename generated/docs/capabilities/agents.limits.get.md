# agents.limits.get

Effective limits of an agent: agent.toml capped by Space caps

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | agent (/agentId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/agents/limits/get |
| MCP tool | agents_limits_get (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  agentId: string;
};
```

## Output

```ts
type Out = {
  limits: {
    runCostMicros?: number;
    dayCostMicros?: number;
    monthCostMicros?: number;
    turnsPerDay?: number;
    minutesPerRun?: number;
    tokensPerDay?: number;
  };
  source: Record<string, "agent" | "person" | "space">;
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
    "agentId": "agt_a1b2c3"
  },
  "output": {
    "limits": {
      "dayCostMicros": 1,
      "minutesPerRun": 1,
      "monthCostMicros": 1,
      "runCostMicros": 1,
      "tokensPerDay": 1,
      "turnsPerDay": 1
    },
    "source": {}
  }
}
```
