# sites.update

Rename a site or change its settings

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
    "name": "example",
    "settings": {},
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "site": {
      "kind": "site",
      "name": "example",
      "owner": "example",
      "productionUrl": "example",
      "repoFolderId": "fld_a1b2c3",
      "siteId": "sit_a1b2c3",
      "stagingUrl": "example",
      "state": "queued"
    }
  }
}
```
