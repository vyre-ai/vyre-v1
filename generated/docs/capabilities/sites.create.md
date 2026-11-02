# sites.create

Create a site: a name, and where it runs (a port on a computer, or a folder in Files). Nothing is served until it is published

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | sites.deploy |
| Grant level | edit |
| Risk | medium |
| Resource | site (create under /folderId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sites/create |
| MCP tool | sites_create (sites) |
| CLI | none |
| Emits | site.created |

## Input

```ts
type In = {
  name: string;
  kind?: "site" | "app" | "api" | "worker" | "artifact";
  repoUrl?: string;
  templateKit?: string;
  slug?: string;
  access?: "public" | "password" | "space" | "private";
  computerId?: string;
  port?: number;
  folderId?: string;
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
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "access": "public",
    "computerId": "cmt_a1b2c3",
    "folderId": "fld_a1b2c3",
    "idempotencyKey": "idem_1",
    "kind": "site",
    "name": "example",
    "port": 1,
    "repoUrl": "example",
    "slug": "example",
    "templateKit": "kit_a1b2c3"
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
