# sites.preview_promote

Serve a preview's build as production without a rebuild, with the production variables

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | sites.deploy |
| Grant level | edit |
| Risk | medium |
| Resource | site (/siteId) |
| Gate | send when vault.key_host_unapproved(input) |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/sites/preview_promote |
| MCP tool | sites_preview_promote (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
  branch: string;
  wait?: boolean;
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
    "branch": "example",
    "siteId": "sit_a1b2c3",
    "wait": true
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
