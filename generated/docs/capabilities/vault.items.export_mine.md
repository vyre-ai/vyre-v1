# vault.items.export_mine

A person exports their own Mine items (also for 30 days after removal); one pull link, audited

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | view |
| Risk | high |
| Resource | space |
| Gate | secret_export |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/vault/items/export_mine |
| MCP tool | vault_items_export_mine (vault) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  expiresIn: "1h" | "1d" | "7d";
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  exportId: string;
  pullUrl: string;
  expiresAt: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.network
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "expiresIn": "1h",
    "idempotencyKey": "idem_1"
  },
  "output": {
    "expiresAt": 1760000000000,
    "exportId": "vex_a1b2c3",
    "pullUrl": "https://example.com"
  }
}
```
