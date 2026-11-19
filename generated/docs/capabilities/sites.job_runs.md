# sites.job_runs

The newest runs of a job (up to 50): when, how long, how it ended and one sentence for any end that is not a success. Its output is in sites_logs_read with source jobs and the run's id as scope

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | site (/siteId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sites/job_runs |
| MCP tool | sites_job_runs (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
  jobId: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  runs: Array<{
      runId: string;
      jobId: string;
      state: "queued" | "running" | "succeeded" | "failed" | "timed_out" | "canceled" | "skipped" | "interrupted";
      at: number;
      startedAt?: number;
      endedAt?: number;
      exitCode?: number;
      note?: string;
      by: "schedule" | "person";
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
    "jobId": "job_a1b2c3",
    "limit": 1,
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "runs": [
      {
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
    ]
  }
}
```
