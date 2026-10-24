# sites.promote

Promote a staging build to production (merges the pull request first when there is one)

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | sites.promote |
| Grant level | manage |
| Risk | high |
| Resource | site (/siteId) |
| Gate | site_promote |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/sites/promote |
| MCP tool | sites_promote (sites) |
| CLI | none |
| Emits | site.promoted |

## Input

```ts
type In = {
  siteId: string;
  deploymentId: string;
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
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "deploymentId": "dpl_a1b2c3",
    "idempotencyKey": "idem_1",
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
