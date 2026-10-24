# vault.import_parse

Preview an import file from 1Password, Bitwarden, LastPass or Chrome: names, kinds, field keys and duplicates (values are not echoed)

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | vault.shared_create |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/vault/import_parse |
| MCP tool | vault_import_parse (vault) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  source: "onepassword" | "bitwarden" | "lastpass" | "chrome";
  fileId: string;
};
```

## Output

```ts
type Out = {
  items: Array<{
      name: string;
      kind: "login" | "api_key" | "env" | "card" | "note" | "totp" | "ssh_key" | "ai_subscription" | "other";
      fieldKeys: Array<string>;
      duplicateOf?: string;
      warnings: Array<string>;
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
    "fileId": "fil_a1b2c3",
    "source": "onepassword"
  },
  "output": {
    "items": [
      {
        "duplicateOf": "vit_a1b2c3",
        "fieldKeys": [
          "api_key"
        ],
        "kind": "login",
        "name": "example",
        "warnings": [
          "example"
        ]
      }
    ]
  }
}
```
