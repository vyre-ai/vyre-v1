# journeys.migrate

Migrate in-flight records to a new Journey version through a stage mapping (a Run; stoppable)

| | |
|---|---|
| Module | journeys |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | journeys.manage |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/journeys/migrate |
| MCP tool | journeys_migrate (automations) |
| CLI | none |
| Emits | journey.migrated, journey.stage_exited, journey.stage_entered |

## Input

```ts
type In = {
  journeyId: string;
  toVersion: number;
  stageMap: Record<string, string>;
  recordIds?: Array<string>;
};
```

## Output

```ts
type Out = {
  runId: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "journeyId": "jrn_a1b2c3",
    "recordIds": [
      "rec_a1b2c3"
    ],
    "stageMap": {},
    "toVersion": 1
  },
  "output": {
    "runId": "run_a1b2c3"
  }
}
```
