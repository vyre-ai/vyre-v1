# projects.apply_cascade

Apply a cascade proposal, or keep the dates

| | |
|---|---|
| Module | projects |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | project (/projectId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/projects/apply_cascade |
| MCP tool | projects_apply_cascade (tasks) |
| CLI | none |
| Emits | project.cascade_applied, project.dates_kept, record.updated |

## Input

```ts
type In = {
  projectId: string;
  proposalId: string;
  decision: "apply" | "keep";
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  moved: number;
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
    "decision": "apply",
    "idempotencyKey": "idem_1",
    "projectId": "prj_a1b2c3",
    "proposalId": "csc_a1b2c3"
  },
  "output": {
    "moved": 1
  }
}
```
