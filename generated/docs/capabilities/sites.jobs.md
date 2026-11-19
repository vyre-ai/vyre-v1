# sites.jobs

Scheduled jobs of a site. action: list (jobs and workers), create, update, delete, run, cancel, runs

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
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/sites/jobs |
| MCP tool | sites_jobs (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
  action: "list" | "create" | "update" | "delete" | "run" | "cancel" | "runs";
  jobId?: string;
  runId?: string;
  name?: string;
  schedule?: string;
  command?: string;
  zone?: string;
  timeoutSec?: number;
  enabled?: boolean;
  limit?: number;
};
```

## Output

```ts
type Out = {
  jobs?: Array<{
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
  services?: Array<{
      serviceId: string;
      siteId: string;
      name: string;
      kind: "worker" | "web";
      command: string;
      state: "stopped" | "starting" | "running" | "backoff" | "failed";
      note?: string;
      startedAt?: number;
      restartAt?: number;
    }>;
  job?: {
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
  run?: {
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
  runs?: Array<{
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
  removed?: boolean;
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
    "action": "list",
    "command": "example",
    "enabled": true,
    "jobId": "job_a1b2c3",
    "limit": 1,
    "name": "example",
    "runId": "jrx_a1b2c3",
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
    },
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
    ],
    "removed": true,
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
    },
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
    ],
    "services": [
      {
        "command": "example",
        "kind": "worker",
        "name": "example",
        "note": "example",
        "restartAt": 1760000000000,
        "serviceId": "wkr_a1b2c3",
        "siteId": "sit_a1b2c3",
        "startedAt": 1760000000000,
        "state": "stopped"
      }
    ]
  }
}
```
