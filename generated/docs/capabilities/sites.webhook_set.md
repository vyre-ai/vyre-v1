# sites.webhook_set

Turn the GitHub webhook on or off, rotate its secret (shown once), or set the branches that get previews

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | sites.deploy |
| Grant level | edit |
| Risk | medium |
| Resource | site (/siteId) |
| Gate | send when vault.key_host_unapproved(input) |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/sites/webhook_set |
| MCP tool | sites_webhook_set (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
  enabled?: boolean;
  rotate?: boolean;
  follow?: Array<string>;
};
```

## Output

```ts
type Out = {
  enabled: boolean;
  url?: string;
  follow: Array<string>;
  secret?: string;
  vault?: string;
  lastDeliveryAt?: number;
  failed: Array<{
      branch: string;
      action: string;
      error: string;
      at: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "enabled": true,
    "follow": [
      "example"
    ],
    "rotate": true,
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "enabled": true,
    "failed": [
      {
        "action": "example",
        "at": 1760000000000,
        "branch": "example",
        "error": "example"
      }
    ],
    "follow": [
      "example"
    ],
    "lastDeliveryAt": 1760000000000,
    "secret": "example",
    "url": "example",
    "vault": "example"
  }
}
```
