# sites.promote

Put a site on the public internet at its address. Held for approval unless the person asked for it this turn

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | sites.deploy |
| Grant level | edit |
| Risk | high |
| Resource | site (/siteId) |
| Gate | site_promote when actor.kind != 'person' |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/sites/promote |
| MCP tool | sites_promote (sites) |
| CLI | none |
| Emits | site.published |

## Input

```ts
type In = {
  siteId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  site: {
    siteId: string;
    name: string;
    kind: "site" | "app" | "api" | "worker" | "artifact";
    owner: string;
    repoFolderId?: string;
    stagingUrl?: string;
    productionUrl?: string;
    state: "queued" | "building" | "ready" | "failed" | "stopped";
    slug?: string;
    url?: string;
    computerId?: string;
    port?: number;
    folderId?: string;
    access?: "public" | "password" | "space" | "private";
    live?: boolean;
    blocked?: boolean;
    updatedAt?: number;
    deployed?: boolean;
    source?: {
      repo?: string;
      branch?: string;
      tokenHandle?: string;
      folderId?: string;
      fileId?: string;
      path?: string;
      root?: string;
    };
    lastDeploy?: {
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
    limits?: {
      cpus: number;
      memoryMb: number;
      diskMb?: number;
    };
    addons?: Array<{
        kind: "postgres" | "redis";
        state: "starting" | "ready" | "failed";
        envName: string;
        detail?: string;
      }>;
    autoDeploy?: boolean;
    passwordSet?: boolean;
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
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "site": {
      "access": "public",
      "addons": [
        {
          "detail": "example",
          "envName": "DATABASE_URL",
          "kind": "postgres",
          "state": "starting"
        }
      ],
      "autoDeploy": true,
      "blocked": true,
      "computerId": "cmt_a1b2c3",
      "deployed": true,
      "folderId": "fld_a1b2c3",
      "kind": "site",
      "lastDeploy": {
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
      },
      "limits": {
        "cpus": 1,
        "diskMb": 256,
        "memoryMb": 128
      },
      "live": true,
      "name": "example",
      "owner": "example",
      "passwordSet": true,
      "port": 1,
      "productionUrl": "example",
      "repoFolderId": "fld_a1b2c3",
      "siteId": "sit_a1b2c3",
      "slug": "example",
      "source": {
        "branch": "main",
        "fileId": "fil_a1b2c3",
        "folderId": "fld_a1b2c3",
        "path": "example",
        "repo": "https://github.com/acme/cx-dashboard",
        "root": "apps/web",
        "tokenHandle": "#Dana_Lawmatics"
      },
      "stagingUrl": "example",
      "state": "queued",
      "updatedAt": 1760000000000,
      "url": "example"
    }
  }
}
```
