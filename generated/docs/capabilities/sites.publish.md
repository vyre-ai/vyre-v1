# sites.publish

Serve a site that is not public: space or private access, or a password on its own domain

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
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sites/publish |
| MCP tool | sites_publish (sites) |
| CLI | none |
| Emits | site.published |

## Input

```ts
type In = {
  siteId: string;
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
    thumb?: string;
    chatId?: string;
    chatTitle?: string;
    sharedWith?: Array<string>;
    sharedAudience?: Array<"link" | "space">;
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
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
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
      "chatId": "example",
      "chatTitle": "example",
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
      "sharedAudience": [
        "link"
      ],
      "sharedWith": [
        "example"
      ],
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
      "thumb": "example",
      "updatedAt": 1760000000000,
      "url": "example"
    }
  }
}
```
