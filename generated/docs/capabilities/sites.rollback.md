# sites.rollback

Serve an earlier build again (the one before the current, or the one named). Its image is kept on the server, so nothing is built

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | sites.deploy |
| Grant level | edit |
| Risk | high |
| Resource | site (/siteId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/sites/rollback |
| MCP tool | sites_rollback (sites) |
| CLI | none |
| Emits | site.rolled_back |

## Input

```ts
type In = {
  siteId: string;
  toDeploymentId?: string;
  idempotencyKey: string;
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
    at: number;
    by?: string;
    note?: string;
    problem?: string;
    fix?: "set_env" | "add_postgres" | "add_redis" | "retry" | "set_start" | "set_port" | "open_logs" | "connect_repo" | "free_space" | "more_memory";
    current?: boolean;
    finishedAt?: number;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.network
- provider.unavailable
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "siteId": "sit_a1b2c3",
    "toDeploymentId": "dpl_a1b2c3"
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
      "note": "example",
      "problem": "example",
      "siteId": "sit_a1b2c3",
      "state": "queued",
      "url": "example"
    }
  }
}
```
