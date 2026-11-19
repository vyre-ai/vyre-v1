# sites.jobs_list

A site's scheduled jobs: each runs a command in the site's own image on a schedule, with the site's environment, and keeps a history

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
| HTTP | POST /v1/sites/jobs_list |
| MCP tool | sites_jobs_list (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
};
```

## Output

```ts
type Out = {
  jobs: Array<{
      jobId: string;
      siteId: string;
      name: string;
      schedule: string;
      when: string;
      command: string;
      zone: string;
      enabled: boolean;
      timeoutSec: number;
      nextAt?: number;
      last?: {
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
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "jobs": [
      {
        "command": "example",
        "enabled": true,
        "jobId": "job_a1b2c3",
        "last": {
          "at": 1760000000000,
          "by": "schedule",
          "endedAt": 1760000000000,
          "exitCode": 1,
          "jobId": "job_a1b2c3",
          "note": "example",
          "runId": "jrx_a1b2c3",
          "startedAt": 1760000000000,
          "state": "queued"
        },
        "name": "example",
        "nextAt": 1760000000000,
        "schedule": "0 2 * * *",
        "siteId": "sit_a1b2c3",
        "timeoutSec": 1,
        "when": "example",
        "zone": "example"
      }
    ]
  }
}
```
