# automations.analytics

Outcomes from runs: totals, success rate, a daily series, the busiest automations and where failures stop

| | |
|---|---|
| Module | automations |
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
| HTTP | POST /v1/automations/analytics |
| MCP tool | automations_analytics (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  automationId?: string;
  days?: number;
};
```

## Output

```ts
type Out = {
  windowDays: number;
  totals: {
    runs: number;
    succeeded: number;
    failed: number;
    stopped: number;
    active: number;
    costMicros: number;
    successRate: number | null;
    medianMs: number | null;
  };
  daily: Array<{
      day: string;
      succeeded: number;
      failed: number;
      other: number;
    }>;
  automations: Array<{
      automationId: string;
      name: string;
      runs: number;
      succeeded: number;
      failed: number;
      lastRunAt: number;
    }>;
  failures: Array<{
      automationId: string | null;
      step: string;
      code: string;
      count: number;
    }>;
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
    "automationId": "aut_a1b2c3",
    "days": 1
  },
  "output": {
    "automations": [
      {
        "automationId": "aut_a1b2c3",
        "failed": 1,
        "lastRunAt": 1760000000000,
        "name": "example",
        "runs": 1,
        "succeeded": 1
      }
    ],
    "daily": [
      {
        "day": "example",
        "failed": 1,
        "other": 1,
        "succeeded": 1
      }
    ],
    "failures": [
      {
        "automationId": "aut_a1b2c3",
        "code": "example",
        "count": 1,
        "step": "example"
      }
    ],
    "totals": {
      "active": 1,
      "costMicros": 1,
      "failed": 1,
      "medianMs": 1,
      "runs": 1,
      "stopped": 1,
      "succeeded": 1,
      "successRate": 1
    },
    "windowDays": 1
  }
}
```
