# terminal.job.stop

Stop a background job of your computer; it stays in the list as stopped, with its log

| | |
|---|---|
| Module | terminal |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | terminal.use |
| Grant level | use |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/terminal/job/stop |
| MCP tool | terminal_job_stop (terminal) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  jobId: string;
  agentId?: string;
};
```

## Output

```ts
type Out = {
  job: {
    jobId: string;
    name: string;
    command: string;
    state: "starting" | "running" | "restarting" | "stopped" | "done" | "failed";
    restart: "on-failure" | "always" | "never";
    startedAt?: number;
    restarts: number;
    exitCode?: number | null;
    lastLine?: string;
    loop?: boolean;
  };
};
```

## Errors

- internal.unavailable
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
    "agentId": "agt_a1b2c3",
    "jobId": "job_a1b2c3d4e5f6"
  },
  "output": {
    "job": {
      "command": "example",
      "exitCode": 1,
      "jobId": "job_a1b2c3d4e5f6",
      "lastLine": "example",
      "loop": true,
      "name": "example",
      "restart": "on-failure",
      "restarts": 1,
      "startedAt": 1760000000000,
      "state": "starting"
    }
  }
}
```
