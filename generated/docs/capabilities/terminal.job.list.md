# terminal.job.list

The background jobs of a computer, newest first: running, restarting or ended, how often each restarted, and the last line it printed. Never wakes the computer

| | |
|---|---|
| Module | terminal |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/terminal/job/list |
| MCP tool | terminal_job_list (terminal) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  agentId?: string;
};
```

## Output

```ts
type Out = {
  jobs: Array<{
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
    }>;
};
```

## Errors

- internal.unavailable
- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3"
  },
  "output": {
    "jobs": [
      {
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
    ]
  }
}
```
