# plugins.marketplace.add

Add a marketplace by git URL (https) or a folder on this server; reads its marketplace.json and puts it on the allowlist

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | kits.install |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/plugins/marketplace/add |
| MCP tool | plugins_marketplace_add (agents) |
| CLI | none |
| Emits | plugin.marketplace_added |

## Input

```ts
type In = {
  source: string;
  ref?: string;
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
- validation.duplicate

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "ref": "example",
    "source": "https://github.com/acme/tools"
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
