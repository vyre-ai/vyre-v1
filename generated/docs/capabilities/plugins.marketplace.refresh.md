# plugins.marketplace.refresh

Fetch a marketplace again and update its list

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | kits.install |
| Grant level | manage |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/plugins/marketplace/refresh |
| MCP tool | plugins_marketplace_refresh (agents) |
| CLI | none |
| Emits | plugin.marketplace_refreshed |

## Input

```ts
type In = {
  marketplaceId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  marketplace: {
    marketplaceId: string;
    name: string;
    kind: "git" | "local";
    source: string;
    ref?: string;
    owner: string;
    description?: string;
    plugins: number;
    allowed: boolean;
    warnings: Array<string>;
    revision?: string;
    updatedAt: number;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.unavailable
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "marketplaceId": "mkt_a1b2c3"
  },
  "output": {
    "marketplace": {
      "allowed": true,
      "description": "example",
      "kind": "git",
      "marketplaceId": "mkt_a1b2c3",
      "name": "acme-tools",
      "owner": "example",
      "plugins": 1,
      "ref": "example",
      "revision": "example",
      "source": "example",
      "updatedAt": 1760000000000,
      "warnings": [
        "example"
      ]
    }
  }
}
```
