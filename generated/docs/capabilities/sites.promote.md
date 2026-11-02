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
