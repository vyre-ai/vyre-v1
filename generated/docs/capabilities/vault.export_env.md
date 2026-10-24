# vault.export_env

Export a folder as a .env file: one pull link that expires after 1 hour, 1 day or 7 days; never for Restricted items; the folder owner is notified

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | vault.export |
| Grant level | use |
| Risk | high |
| Resource | vault_folder (/folderId) |
| Gate | secret_export |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/vault/export_env |
| MCP tool | vault_export_env (vault) |
| CLI | none |
| Emits | vault.exported |

## Input

```ts
type In = {
  folderId: string;
  expiresIn: "1h" | "1d" | "7d";
  itemIds?: Array<string>;
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
    "expiresIn": "1h",
    "folderId": "vfd_a1b2c3",
    "idempotencyKey": "idem_1",
    "itemIds": [
      "vit_a1b2c3"
    ]
  },
  "output": {
    "expiresAt": 1760000000000,
    "exportId": "vex_a1b2c3",
    "pullUrl": "https://example.com"
  }
}
```
