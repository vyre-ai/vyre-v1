# journeys.move_stage

Move a Journey record to another stage by hand; the reason is required and handoffs post in the record channel

| | |
|---|---|
| Module | journeys |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | journeys.manage |
| Grant level | edit |
| Risk | medium |
| Resource | record (/recordId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/journeys/move_stage |
| MCP tool | journeys_move_stage (automations) |
| CLI | none |
| Emits | journey.stage_exited, journey.stage_entered, journey.moved, journey.completed |

## Input

```ts
type In = {
  journeyId: string;
  recordId: string;
  toStage: string;
  reason: string;
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
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "journeyId": "jrn_a1b2c3",
    "reason": "example",
    "recordId": "rec_a1b2c3",
    "toStage": "intake"
  },
  "output": {
    "recordId": "rec_a1b2c3",
    "stage": "intake"
  }
}
```
