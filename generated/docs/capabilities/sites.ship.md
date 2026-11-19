# sites.ship

Put an app on the web in one call: create the site from its source (or take siteId), set env from Vault handles, add Postgres or Redis, deploy and wait. Answers with the address, or the failed step, reason and fix. Call again with the returned siteId to go on

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | sites.deploy |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/sites/ship |
| MCP tool | sites_ship (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId?: string;
  name?: string;
  source?: {
    repo?: string;
    branch?: string;
    tokenHandle?: string;
    folderId?: string;
    fileId?: string;
    path?: string;
    root?: string;
  };
  kind?: "site" | "app" | "api" | "worker";
  access?: "public" | "password" | "space" | "private";
  limits?: {
    cpus: number;
    memoryMb: number;
    diskMb?: number;
  };
  env?: Array<{
      name: string;
      vaultHandle: string;
    }>;
  addons?: Array<"postgres" | "redis">;
  wait?: boolean;
};
```

## Output

```ts
type Out = {
  ok: boolean;
  siteId: string;
  address?: string;
  say: string;
  failedStep?: "setup" | "fetch" | "build" | "start" | "check";
  problem?: string;
  fix?: "set_env" | "add_postgres" | "add_redis" | "retry" | "set_start" | "set_port" | "open_logs" | "connect_repo" | "free_space" | "more_memory";
  deployment?: {
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
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "access": "public",
    "addons": [
      "postgres"
    ],
    "env": [
      {
        "name": "example",
        "vaultHandle": "#Dana_Lawmatics"
      }
    ],
    "kind": "site",
    "limits": {
      "cpus": 1,
      "diskMb": 256,
      "memoryMb": 128
    },
    "name": "example",
    "siteId": "sit_a1b2c3",
    "source": {
      "branch": "main",
      "fileId": "fil_a1b2c3",
      "folderId": "fld_a1b2c3",
      "path": "example",
      "repo": "https://github.com/acme/cx-dashboard",
      "root": "apps/web",
      "tokenHandle": "#Dana_Lawmatics"
    },
    "wait": true
  },
  "output": {
    "address": "example",
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
    },
    "failedStep": "setup",
    "fix": "set_env",
    "ok": true,
    "problem": "example",
    "say": "example",
    "siteId": "sit_a1b2c3"
  }
}
```
