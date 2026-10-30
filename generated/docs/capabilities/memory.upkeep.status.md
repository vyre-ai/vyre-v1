# memory.upkeep.status

Upkeep spend: this month against the monthly cap, and the recent runs with what each did and cost

| | |
|---|---|
| Module | memory |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | memory.admin |
| Grant level | manage |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/memory/upkeep/status |
| MCP tool | memory_upkeep_status (memory) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  limit?: number;
};
```

## Output

```ts
type Out = {
  month: string;
  spentMicros: number;
  capMicros: number;
  capReached: boolean;
  modelAvailable: boolean;
  openQuestions: number;
  runs: Array<{
      runId: string;
      startedAt: number;
      finishedAt?: number;
      modelUsed: boolean;
      merged: number;
      flagged: number;
      stale: number;
      created: number;
      corrected: number;
      deleted: number;
      tidied: number;
      tokensIn: number;
      tokensOut: number;
      costMicros: number;
      stopped?: "cap" | "no_key";
    }>;
  nights: Array<{
      day: string;
      runs: number;
      costMicros: number;
      tokensIn: number;
      tokensOut: number;
    }>;
  lastNight?: {
    day: string;
    runs: number;
    costMicros: number;
    tokensIn: number;
    tokensOut: number;
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
    "limit": 1
  },
  "output": {
    "capMicros": 1,
    "capReached": true,
    "lastNight": {
      "costMicros": 1,
      "day": "example",
      "runs": 1,
      "tokensIn": 1,
      "tokensOut": 1
    },
    "modelAvailable": true,
    "month": "example",
    "nights": [
      {
        "costMicros": 1,
        "day": "example",
        "runs": 1,
        "tokensIn": 1,
        "tokensOut": 1
      }
    ],
    "openQuestions": 1,
    "runs": [
      {
        "corrected": 1,
        "costMicros": 1,
        "created": 1,
        "deleted": 1,
        "finishedAt": 1760000000000,
        "flagged": 1,
        "merged": 1,
        "modelUsed": true,
        "runId": "example",
        "stale": 1,
        "startedAt": 1760000000000,
        "stopped": "cap",
        "tidied": 1,
        "tokensIn": 1,
        "tokensOut": 1
      }
    ],
    "spentMicros": 1
  }
}
```
