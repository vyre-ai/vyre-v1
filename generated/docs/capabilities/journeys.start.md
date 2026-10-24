# journeys.start

Start a Journey on a subject record: creates the Journey record with its channel and folder and enters the first stage

| | |
|---|---|
| Module | journeys |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | record (/subjectRecordId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/journeys/start |
| MCP tool | journeys_start (automations) |
| CLI | none |
| Emits | journey.started, journey.stage_entered |

## Input

```ts
type In = {
  journeyId: string;
  subjectRecordId: string;
  startStage?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  recordId: string;
  stage: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.duplicate
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "journeyId": "jrn_a1b2c3",
    "startStage": "intake",
    "subjectRecordId": "rec_a1b2c3"
  },
  "output": {
    "recordId": "rec_a1b2c3",
    "stage": "intake"
  }
}
```
