# vault.import

Import items in one step into a folder; the file is deleted afterwards

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | vault.shared_create |
| Grant level | edit |
| Risk | medium |
| Resource | vault_folder (/folderId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/vault/import |
| MCP tool | vault_import (vault) |
| CLI | none |
| Emits | vault.imported, vault.item_created |

## Input

```ts
type In = {
  source: "onepassword" | "bitwarden" | "lastpass" | "chrome";
  fileId: string;
  folderId: string;
  dedupe: "skip" | "overwrite" | "keep_both";
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  created: number;
  updated: number;
  skipped: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "dedupe": "skip",
    "fileId": "fil_a1b2c3",
    "folderId": "vfd_a1b2c3",
    "idempotencyKey": "idem_1",
    "source": "onepassword"
  },
  "output": {
    "created": 1,
    "skipped": 1,
    "updated": 1
  }
}
```
