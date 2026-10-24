# sites.deploy

Deploy a build to the always-password-protected staging URL

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
| Team Space only | yes |
| HTTP | POST /v1/sites/deploy |
| MCP tool | sites_deploy (sites) |
| CLI | none |
| Emits | site.deployed |

## Input

```ts
type In = {
  siteId: string;
  deploymentId?: string;
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
    "deploymentId": "dpl_a1b2c3",
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
