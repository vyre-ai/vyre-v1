# governance.jobs.run_now

Run one retention job now

| | |
|---|---|
| Module | governance |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | policy.manage |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/governance/jobs/run_now |
| MCP tool | governance_jobs_run_now (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  kind: "trash" | "run_logs" | "transcripts" | "audit" | "file_versions" | "logs" | "events" | "backups" | "memory" | "records";
  idempotencyKey: string;
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
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "kind": "trash"
  },
  "output": {
    "runId": "run_a1b2c3"
  }
}
```
