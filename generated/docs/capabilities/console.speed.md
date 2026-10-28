# console.speed

Speed page: spans rolled up per budget id, p50 and p95 against perf/budgets.json, link to the worst trace

| | |
|---|---|
| Module | console-views |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | console.access |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/console/speed |
| MCP tool | console_speed (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  windowMinutes?: number;
};
```

## Output

```ts
type Out = {
  rows: Array<{
      budgetId: string;
      unit: string;
      sense: "min" | "max" | "exact";
      p50: number;
      p95: number;
      budgetP95: number;
      worstTraceId?: string;
      over: boolean;
    }>;
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
    "windowMinutes": 1
  },
  "output": {
    "rows": [
      {
        "budgetId": "example",
        "budgetP95": 1,
        "over": true,
        "p50": 1,
        "p95": 1,
        "sense": "min",
        "unit": "example",
        "worstTraceId": "0123456789abcdef0123456789abcdef"
      }
    ]
  }
}
```
