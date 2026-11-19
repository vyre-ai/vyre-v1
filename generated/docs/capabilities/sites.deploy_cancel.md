# sites.deploy_cancel

Cancel the running deploy. The last good build keeps serving

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
| HTTP | POST /v1/sites/deploy_cancel |
| MCP tool | sites_deploy_cancel (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
  deploymentId?: string;
};
```

## Output

```ts
type Out = {
  deployment: {
    deploymentId: string;
    siteId: string;
    env: "staging" | "preview" | "production";
    state: "queued" | "building" | "ready" | "failed" | "stopped";
    url?: string;
    branch?: string;
    commit?: string;
    message?: string;
    at: number;
    by?: string;
    note?: string;
    problem?: string;
    fix?: "set_env" | "add_postgres" | "add_redis" | "retry" | "set_start" | "set_port" | "open_logs" | "connect_repo" | "free_space" | "more_memory";
    current?: boolean;
    finishedAt?: number;
    steps?: Array<{
        key: "fetch" | "build" | "start" | "check";
        state: "waiting" | "running" | "ok" | "failed" | "skipped";
        ms?: number;
        startedAt?: number;
      }>;
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
    "deploymentId": "dpl_a1b2c3",
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "deployment": {
      "at": 1760000000000,
      "branch": "example",
      "by": "example",
      "commit": "example",
      "current": true,
      "deploymentId": "dpl_a1b2c3",
      "env": "staging",
      "finishedAt": 1760000000000,
      "fix": "set_env",
      "message": "example",
      "note": "example",
      "problem": "example",
      "siteId": "sit_a1b2c3",
      "state": "queued",
      "steps": [
        {
          "key": "fetch",
          "ms": 1,
          "startedAt": 1760000000000,
          "state": "waiting"
        }
      ],
      "url": "example"
    }
  }
}
```
