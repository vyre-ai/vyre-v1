# plugins.marketplace.remove

Remove a marketplace; the plugins installed from it stay until they are removed

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
| HTTP | POST /v1/plugins/marketplace/remove |
| MCP tool | plugins_marketplace_remove (agents) |
| CLI | none |
| Emits | plugin.marketplace_removed |

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
  removed: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "marketplaceId": "mkt_a1b2c3"
  },
  "output": {
    "removed": true
  }
}
```
