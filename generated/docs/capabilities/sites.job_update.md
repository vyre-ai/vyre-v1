# sites.job_update

Change a scheduled job: its name, schedule, command, time zone, time limit, or pause and resume it. Resuming does not run what was missed

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | sites.deploy |
| Grant level | edit |
| Risk | medium |
| Resource | site (/siteId) |
| Gate | delete when sites.run_update_gate(input) |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/sites/job_update |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
  jobId: string;
  name?: string;
  schedule?: string;
  command?: string;
  zone?: string;
  timeoutSec?: number;
  enabled?: boolean;
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

## Example

```json
{
  "name": "example",
  "input": {
    "command": "example",
    "enabled": true,
    "jobId": "job_a1b2c3",
    "name": "example",
    "schedule": "example",
    "siteId": "sit_a1b2c3",
    "timeoutSec": 5,
    "zone": "example"
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
