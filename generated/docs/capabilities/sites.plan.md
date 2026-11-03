# sites.plan

What a deploy would do with this source, before running it: how it is built and started, the port, and the databases and env names it looks for (read from railway.json, nixpacks.toml, a Procfile, package.json, requirements.txt or a Dockerfile)

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | sites.deploy |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sites/plan |
| MCP tool | sites_plan (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId?: string;
  source?: {
    repo?: string;
    branch?: string;
    tokenHandle?: string;
    folderId?: string;
    fileId?: string;
    path?: string;
    root?: string;
  };
};
```

## Output

```ts
type Out = {
  kind: string;
  note: string;
  build?: string;
  start?: string;
  port?: number;
  needs: Array<"postgres" | "redis">;
  env: Array<string>;
  from: Array<string>;
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
    "siteId": "sit_a1b2c3",
    "source": {
      "branch": "main",
      "fileId": "fil_a1b2c3",
      "folderId": "fld_a1b2c3",
      "path": "example",
      "repo": "https://github.com/acme/cx-dashboard",
      "root": "apps/web",
      "tokenHandle": "#Dana_Lawmatics"
    }
  },
  "output": {
    "build": "example",
    "env": [
      "example"
    ],
    "from": [
      "example"
    ],
    "kind": "example",
    "needs": [
      "postgres"
    ],
    "note": "example",
    "port": 1,
    "start": "example"
  }
}
```
