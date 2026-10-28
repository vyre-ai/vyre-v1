# automations.migration_preview

Group active runs by the step they are on before moving them to a definition version

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | automation (/automationId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/automations/migration_preview |
| MCP tool | automations_migration_preview (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  automationId: string;
  toVersion: number;
};
```

## Output

```ts
type Out = {
  cohorts: Array<{
      definitionVersion: number;
      currentStepId: string | null;
      runIds: Array<string>;
      disposition: "safe" | "ambiguous" | "inactive";
      proposedStepId: string | null;
      reason: string;
      repeatedEffects: Array<string>;
      skippedEffects: Array<string>;
    }>;
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
    "automationId": "aut_a1b2c3",
    "toVersion": 1
  },
  "output": {
    "cohorts": [
      {
        "currentStepId": "example",
        "definitionVersion": 1,
        "disposition": "safe",
        "proposedStepId": "example",
        "reason": "example",
        "repeatedEffects": [
          "example"
        ],
        "runIds": [
          "run_a1b2c3"
        ],
        "skippedEffects": [
          "example"
        ]
      }
    ]
  }
}
```
