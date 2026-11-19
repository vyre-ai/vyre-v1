# sites.job_cancel

Stop a job run that is queued or going

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | sites.deploy |
| Grant level | edit |
| Risk | medium |
| Resource | site (/siteId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sites/job_cancel |
| MCP tool | sites_job_cancel (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
  runId: string;
};
```

## Output

```ts
type Out = {
  run: {
    runId: string;
    jobId: string;
    state: "queued" | "running" | "succeeded" | "failed" | "timed_out" | "canceled" | "skipped" | "interrupted";
    at: number;
    startedAt?: number;
    endedAt?: number;
    exitCode?: number;
    note?: string;
    by: "schedule" | "person";
  };
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
    "runId": "jrx_a1b2c3",
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "run": {
      "at": 1760000000000,
      "by": "schedule",
      "endedAt": 1760000000000,
      "exitCode": 1,
      "jobId": "job_a1b2c3",
      "note": "example",
      "runId": "jrx_a1b2c3",
      "startedAt": 1760000000000,
      "state": "queued"
    }
  }
}
```
