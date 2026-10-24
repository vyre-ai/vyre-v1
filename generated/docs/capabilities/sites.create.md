# sites.create

Create a site with its root folder under Deployments/

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | sites.deploy |
| Grant level | edit |
| Risk | medium |
| Resource | site (create under /name) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/sites/create |
| MCP tool | sites_create (sites) |
| CLI | none |
| Emits | site.created |

## Input

```ts
type In = {
  name: string;
  kind: "site" | "app" | "api" | "worker" | "artifact";
  repoUrl?: string;
  templateKit?: string;
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
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "kind": "site",
    "name": "example",
    "repoUrl": "example",
    "templateKit": "kit_a1b2c3"
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
