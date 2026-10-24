# vault.item.get

One item: metadata and field keys, never values

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | use |
| Risk | low |
| Resource | vault_item (/itemId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/vault/item/get |
| MCP tool | vault_item_get (vault) |
| CLI | vyre vault get |
| Emits | none |

## Input

```ts
type In = {
  itemId: string;
};
```

## Output

```ts
type Out = {
  item: {
    id: string;
    name: string;
    kind: "login" | "api_key" | "env" | "card" | "note" | "totp" | "ssh_key" | "ai_subscription" | "other";
    folderId: string;
    owner: string;
    scope: "mine" | "shared";
    fieldKeys: Array<string>;
    handle: string;
    spaceOnly: boolean;
    injectIntoDeployments: boolean;
    rotateEveryDays?: number;
    lastRotatedAt?: number;
    lastUsedAt?: number;
    yourLevel: "view" | "use" | "edit" | "manage";
    label: number;
    createdAt: number;
    updatedAt: number;
  };
  fields: Array<{
      key: string;
      secret: boolean;
      hasValue: boolean;
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
    "itemId": "vit_a1b2c3"
  },
  "output": {
    "fields": [
      {
        "hasValue": true,
        "key": "api_key",
        "secret": true
      }
    ],
    "item": {
      "createdAt": 1760000000000,
      "fieldKeys": [
        "api_key"
      ],
      "folderId": "vfd_a1b2c3",
      "handle": "#Dana_Lawmatics",
      "id": "vit_a1b2c3",
      "injectIntoDeployments": true,
      "kind": "login",
      "label": 1,
      "lastRotatedAt": 1760000000000,
      "lastUsedAt": 1760000000000,
      "name": "example",
      "owner": "usr_a1b2c3",
      "rotateEveryDays": 1,
      "scope": "mine",
      "spaceOnly": true,
      "updatedAt": 1760000000000,
      "yourLevel": "view"
    }
  }
}
```
