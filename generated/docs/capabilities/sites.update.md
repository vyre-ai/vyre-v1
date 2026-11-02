# sites.update

Rename a site, change its settings, where it runs or who may reach it. Making it public takes it down until it is published again

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
| HTTP | POST /v1/sites/update |
| MCP tool | sites_update (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
  name?: string;
  settings?: Record<string, unknown>;
  access?: "public" | "password" | "space" | "private";
  computerId?: string;
  port?: number;
  folderId?: string;
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
    "access": "public",
    "computerId": "cmt_a1b2c3",
    "folderId": "fld_a1b2c3",
    "name": "example",
    "port": 1,
    "settings": {},
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "site": {
      "access": "public",
      "blocked": true,
      "computerId": "cmt_a1b2c3",
      "folderId": "fld_a1b2c3",
      "kind": "site",
      "live": true,
      "name": "example",
      "owner": "example",
      "port": 1,
      "productionUrl": "example",
      "repoFolderId": "fld_a1b2c3",
      "siteId": "sit_a1b2c3",
      "slug": "example",
      "stagingUrl": "example",
      "state": "queued",
      "updatedAt": 1760000000000,
      "url": "example"
    }
  }
}
```
