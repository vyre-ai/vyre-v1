# terminal.job.start

Keep a command running on your computer as a background job (a server, a watcher, a bot): it is started again if it dies and after a restart, keeps its log, and keeps your computer awake until it ends. Gated like terminal.run

| | |
|---|---|
| Module | terminal |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | terminal.use |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | approve when terminal.is_danger(input.command) |
| Idempotency | key |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/terminal/job/start |
| MCP tool | terminal_job_start (terminal) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  command: string;
  name?: string;
  cwd?: string;
  env?: Record<string, string>;
  restart?: "on-failure" | "always" | "never";
  agentId?: string;
  idempotencyKey: string;
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
  };
};
```

## Errors

- internal.unavailable
- internal.unexpected
- permission.above_clearance
- permission.needs_approval
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "command": "example",
    "cwd": "example",
    "env": {},
    "idempotencyKey": "idem_1",
    "name": "example",
    "restart": "on-failure"
  },
  "output": {
    "job": {
      "command": "example",
      "exitCode": 1,
      "jobId": "job_a1b2c3d4e5f6",
      "lastLine": "example",
      "name": "example",
      "restart": "on-failure",
      "restarts": 1,
      "startedAt": 1760000000000,
      "state": "starting"
    }
  }
}
```
