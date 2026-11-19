# sites.webhook_get

GitHub webhook of a site: on or off, its address, the branches that get a preview. The secret is never shown again

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | site (/siteId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sites/webhook_get |
| MCP tool | sites_webhook_get (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
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
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
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
