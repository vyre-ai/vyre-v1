# sites.job_create

Add a scheduled job to a deployed site: a command run on a cron schedule in the site's image, with its variables

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
| Idempotency | key |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/sites/job_create |
| MCP tool | sites_job_create (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
  name: string;
  schedule: string;
  command: string;
  zone?: string;
  timeoutSec?: number;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  job: {
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
    "command": "node scripts/sync-stock.js",
    "idempotencyKey": "idem_1",
    "name": "example",
    "schedule": "0 2 * * *",
    "siteId": "sit_a1b2c3",
    "timeoutSec": 5,
    "zone": "America/New_York"
  },
  "output": {
    "job": {
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
  }
}
```
