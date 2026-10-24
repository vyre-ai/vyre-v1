# sites.preview_rebuild

Rebuild a preview or bring back a removed one

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
| Team Space only | yes |
| HTTP | POST /v1/sites/preview_rebuild |
| MCP tool | sites_preview_rebuild (sites) |
| CLI | none |
| Emits | site.preview_created |

## Input

```ts
type In = {
  siteId: string;
  branch: string;
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
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "branch": "example",
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "deployment": {
      "at": 1760000000000,
      "branch": "example",
      "commit": "example",
      "deploymentId": "dpl_a1b2c3",
      "env": "staging",
      "siteId": "sit_a1b2c3",
      "state": "queued",
      "url": "example"
    }
  }
}
```
