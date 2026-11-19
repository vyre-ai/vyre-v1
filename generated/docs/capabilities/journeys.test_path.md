# journeys.test_path

Try every stage's Automations on one record as tests; sends and writes are held

| | |
|---|---|
| Module | journeys |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | journeys.manage |
| Grant level | use |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/journeys/test_path |
| MCP tool | journeys_test_path (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  journeyId: string;
  recordId?: string;
};
```

## Output

```ts
type Out = {
  runs: Array<{
      stage: string;
      automationId: string;
      runId?: string;
      error?: string;
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
    "journeyId": "jrn_a1b2c3",
    "recordId": "rec_a1b2c3"
  },
  "output": {
    "runs": [
      {
        "automationId": "aut_a1b2c3",
        "error": "example",
        "runId": "run_a1b2c3",
        "stage": "intake"
      }
    ]
  }
}
```
