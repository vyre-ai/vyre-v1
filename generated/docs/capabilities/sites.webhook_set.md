# sites.webhook_set

Turn GitHub's webhook on or off for a site that comes from a repo, make a new secret (rotate; the answer shows it once), or set which branches get a preview on a push (names, prefixes ending in *, or *). The production branch deploys on a push when the site deploys on push

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
  lastDeliveryAt?: number;
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
    "follow": [
      "example"
    ],
    "lastDeliveryAt": 1760000000000,
    "secret": "example",
    "url": "example"
  }
}
```
