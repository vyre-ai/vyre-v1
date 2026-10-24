# sites.rollback

Roll production back to an earlier build

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | sites.promote |
| Grant level | manage |
| Risk | high |
| Resource | site (/siteId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/sites/rollback |
| MCP tool | sites_rollback (sites) |
| CLI | none |
| Emits | site.rolled_back |

## Input

```ts
type In = {
  siteId: string;
  toDeploymentId?: string;
  idempotencyKey: string;
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
- provider.network
- provider.unavailable
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "siteId": "sit_a1b2c3",
    "toDeploymentId": "dpl_a1b2c3"
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
