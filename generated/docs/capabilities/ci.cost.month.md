# ci.cost.month

What CI cost this month so far (or the month given, written 2026-11), the cap, what is left, how many runs, and the cost by repository. Admin only

| | |
|---|---|
| Module | ci |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | connectors.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/ci/cost/month |
| MCP tool | ci_cost_month (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  month?: string;
};
```

## Output

```ts
type Out = {
  month: string;
  spentUsd: number;
  capUsd: number;
  leftUsd: number;
  runs: number;
  paused: boolean;
  byRepo: Array<{
      repo: string;
      runs: number;
      costUsd: number;
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
    "month": "2026-11"
  },
  "output": {
    "byRepo": [
      {
        "costUsd": 1,
        "repo": "vyre-ai/website",
        "runs": 1
      }
    ],
    "capUsd": 1,
    "leftUsd": 1,
    "month": "example",
    "paused": true,
    "runs": 1,
    "spentUsd": 1
  }
}
```
