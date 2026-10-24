# governance.jobs.list

The retention jobs: last run, next run, what was removed, what a hold skipped

| | |
|---|---|
| Module | governance |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | policy.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/governance/jobs/list |
| MCP tool | governance_jobs_list (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  jobs: Array<{
      kind: "trash" | "run_logs" | "transcripts" | "audit" | "file_versions" | "logs" | "events" | "backups" | "memory" | "records";
      lastRunAt?: number;
      nextRunAt?: number;
      lastRemoved?: number;
      lastSkippedOnHold?: number;
      state: "idle" | "running" | "failed";
    }>;
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
  "input": {},
  "output": {
    "jobs": [
      {
        "kind": "trash",
        "lastRemoved": 1,
        "lastRunAt": 1760000000000,
        "lastSkippedOnHold": 1,
        "nextRunAt": 1760000000000,
        "state": "idle"
      }
    ]
  }
}
```
