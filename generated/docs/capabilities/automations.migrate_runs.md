# automations.migrate_runs

Move selected active runs onto a definition version without replaying finished steps

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | automation (/automationId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/automations/migrate_runs |
| MCP tool | automations_migrate_runs (automations) |
| CLI | none |
| Emits | automation.runs_migrated |

## Input

```ts
type In = {
  automationId: string;
  toVersion: number;
  runIds: Array<string>;
};
```

## Output

```ts
type Out = {
  moved: Array<{
      runId: string;
      fromVersion: number;
      toVersion: number;
      atStepId: string;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "automationId": "aut_a1b2c3",
    "runIds": [
      "run_a1b2c3"
    ],
    "toVersion": 1
  },
  "output": {
    "moved": [
      {
        "atStepId": "example",
        "fromVersion": 1,
        "runId": "run_a1b2c3",
        "toVersion": 1
      }
    ]
  }
}
```
