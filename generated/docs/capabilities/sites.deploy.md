# sites.deploy

Build the site from its source (GitHub repo, folder or zip in Files, or a folder here) and run it on this Space, like Railway: Dockerfile, Node, Next.js, Vite, Python or static. The last good build serves until the new one answers. wait returns when it ends

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
| HTTP | POST /v1/sites/deploy |
| MCP tool | sites_deploy (sites) |
| CLI | none |
| Emits | site.deployed, site.build_failed, site.preview_removed |

## Input

```ts
type In = {
  siteId: string;
  source?: {
    repo?: string;
    branch?: string;
    tokenHandle?: string;
    folderId?: string;
    fileId?: string;
    path?: string;
    root?: string;
  };
  wait?: boolean;
  onlyIfChanged?: boolean;
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
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "onlyIfChanged": true,
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
