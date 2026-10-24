# vault.exports.list

Export pull links that are still open

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | vault.export |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/vault/exports/list |
| MCP tool | vault_exports_list (vault) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  folderId?: string;
};
```

## Output

```ts
type Out = {
  exports: Array<{
      id: string;
      folderId: string;
      by: string;
      expiresAt: number;
      pulled: boolean;
    }>;
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
    "folderId": "vfd_a1b2c3"
  },
  "output": {
    "exports": [
      {
        "by": "usr_a1b2c3",
        "expiresAt": 1760000000000,
        "folderId": "vfd_a1b2c3",
        "id": "vex_a1b2c3",
        "pulled": true
      }
    ]
  }
}
```
