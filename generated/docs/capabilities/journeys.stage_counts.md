# journeys.stage_counts

Records in flight per stage, with how many are over their time limit

| | |
|---|---|
| Module | journeys |
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
| HTTP | POST /v1/journeys/stage_counts |
| MCP tool | journeys_stage_counts (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  journeyId: string;
};
```

## Output

```ts
type Out = {
  stages: Array<{
      stage: string;
      count: number;
      overLimit: number;
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
    "journeyId": "jrn_a1b2c3"
  },
  "output": {
    "stages": [
      {
        "count": 1,
        "overLimit": 1,
        "stage": "intake"
      }
    ]
  }
}
```
