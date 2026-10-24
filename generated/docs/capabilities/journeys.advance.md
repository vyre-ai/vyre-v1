# journeys.advance

Check the exit rule of the current stage and advance when its required tasks are done (called on task.completed)

| | |
|---|---|
| Module | journeys |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | record (/recordId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/journeys/advance |
| MCP tool | none |
| CLI | none |
| Emits | journey.stage_exited, journey.stage_entered, journey.completed |

## Input

```ts
type In = {
  recordId: string;
};
```

## Output

```ts
type Out = {
  advanced: boolean;
  stage?: string;
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
    "recordId": "rec_a1b2c3"
  },
  "output": {
    "advanced": true,
    "stage": "intake"
  }
}
```
